import * as amqp from 'amqplib/callback_api';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { config, configService } from '../../config';
import { 
  MessageProcessor as IMessageProcessor, 
  MessageHandler, 
  RabbitMQMessage, 
  InboundMessage,
  OutboundMessage 
} from '../../types';

export class MessageProcessor extends EventEmitter implements IMessageProcessor {
  private connection: amqp.Connection | null = null;
  private channel: amqp.Channel | null = null;
  private isConnected = false;
  private handlers: Map<string, MessageHandler<any>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private isShuttingDown = false;

  constructor() {
    super();
    this.setupGracefulShutdown();
  }

  /**
   * Start the message processor and establish RabbitMQ connection
   */
  async start(): Promise<void> {
    console.log('🚀 Starting Message Processor...');
    
    try {
      await this.connect();
      await this.setupExchangesAndQueues();
      await this.startConsumers();
      
      console.log('✅ Message Processor started successfully');
      this.emit('started');
    } catch (error) {
      console.error('❌ Failed to start Message Processor:', error);
      throw error;
    }
  }

  /**
   * Stop the message processor and close connections
   */
  async stop(): Promise<void> {
    console.log('🛑 Stopping Message Processor...');
    this.isShuttingDown = true;

    try {
      if (this.channel) {
        this.channel.close(() => {});
        this.channel = null;
      }

      if (this.connection) {
        this.connection.close();
        this.connection = null;
      }

      this.isConnected = false;
      console.log('✅ Message Processor stopped');
      this.emit('stopped');
    } catch (error) {
      console.error('Error stopping Message Processor:', error);
    }
  }

  /**
   * Register a message handler for specific message types
   */
  registerHandler<T extends RabbitMQMessage>(handler: MessageHandler<T>): void {
    const handlerId = uuidv4();
    this.handlers.set(handlerId, handler);
    console.log(`📝 Registered message handler: ${handlerId}`);
  }

  /**
   * Publish a message to an exchange with routing key
   */
  async publishMessage(exchange: string, routingKey: string, message: RabbitMQMessage): Promise<void> {
    if (!this.channel || !this.isConnected) {
      throw new Error('Message processor not connected');
    }

    try {
      const exchangeName = configService.getExchangeName(exchange);
      const messageBuffer = Buffer.from(JSON.stringify(message));
      
      const published = this.channel.publish(
        exchangeName,
        routingKey,
        messageBuffer,
        {
          persistent: true,
          messageId: message.id,
          timestamp: Date.now(),
          headers: {
            'x-message-type': message.type,
            'x-retry-count': message.retryCount.toString(),
            'x-priority': message.priority
          }
        }
      );

      if (!published) {
        throw new Error('Failed to publish message - channel buffer full');
      }

      console.log(`📤 Published message: ${message.type} to ${exchangeName}/${routingKey}`);
    } catch (error) {
      console.error('Failed to publish message:', error);
      throw error;
    }
  }

  /**
   * Publish event to copy trade events exchange
   */
  async publishEvent(routingKey: string, event: OutboundMessage): Promise<void> {
    await this.publishMessage(
      config.messaging.exchanges.copyTradeEvents,
      routingKey,
      event
    );
  }

  /**
   * Publish notification to notifications exchange
   */
  async publishNotification(notification: OutboundMessage): Promise<void> {
    console.log("notification:", notification);
    await this.publishMessage(
      config.messaging.exchanges.notifications,
      config.messaging.routingKeys.notification,
      notification
    );
  }

  /**
   * Establish connection to RabbitMQ
   */
  private async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      console.log(`🔌 Connecting to RabbitMQ: ${config.messaging.rabbitmqUrl}`);
      
      amqp.connect(config.messaging.rabbitmqUrl, (error0, connection) => {
        if (error0) {
          reject(error0);
          return;
        }

        this.connection = connection;
        
        connection.createChannel((error1, channel) => {
          if (error1) {
            reject(error1);
            return;
          }

          this.channel = channel;
          
          // Set prefetch to limit concurrent message processing
          channel.prefetch(config.processing.maxConcurrentTrades);
          
          this.isConnected = true;
          this.reconnectAttempts = 0;
          
          console.log('✅ Connected to RabbitMQ');

          // Setup error handlers
          connection.on('error', (error) => {
            console.error('RabbitMQ connection error:', error);
            this.handleConnectionError(error);
          });

          connection.on('close', () => {
            console.log('RabbitMQ connection closed');
            if (!this.isShuttingDown) {
              this.handleConnectionClose();
            }
          });

          resolve();
        });
      });
    });
  }

  /**
   * Setup exchanges and queues
   */
  private async setupExchangesAndQueues(): Promise<void> {
    if (!this.channel) throw new Error('Channel not available');

    console.log('⚙️  Setting up RabbitMQ exchanges and queues...');

    // Setup exchanges
    const exchanges = config.messaging.exchanges;
    for (const [name, exchange] of Object.entries(exchanges)) {
      const exchangeName = configService.getExchangeName(exchange);
      await this.channel.assertExchange(exchangeName, 'topic', {
        durable: true,
        autoDelete: false
      });
      console.log(`📋 Created exchange: ${exchangeName} (${name})`);
    }

    // Setup queues
    const queues = config.messaging.queues;
    for (const [name, queue] of Object.entries(queues)) {
      const queueName = configService.getQueueName(queue);
      
      const queueOptions: any = {
        durable: true,
        autoDelete: false,
        arguments: {
          'x-message-ttl': 3600000, // 1 hour TTL
        }
      };

      // Setup dead letter queue routing for non-DLQ queues
      if (name !== 'deadLetter') {
        queueOptions.arguments['x-dead-letter-exchange'] = configService.getExchangeName(exchanges.deadLetter);
        queueOptions.arguments['x-dead-letter-routing-key'] = 'failed';
      }

      await this.channel.assertQueue(queueName, queueOptions);
      console.log(`📄 Created queue: ${queueName} (${name})`);
    }

    // Setup queue bindings
    await this.setupQueueBindings();
  }

  /**
   * Setup queue bindings to exchanges
   */
  private async setupQueueBindings(): Promise<void> {
    if (!this.channel) throw new Error('Channel not available');

    const { exchanges, queues, routingKeys } = config.messaging;

    // Bind inbound command queues to commands exchange
    const commandsExchange = configService.getExchangeName(exchanges.commands);
    
    await this.channel.bindQueue(
      configService.getQueueName(queues.subscriptionCommands),
      commandsExchange,
      'subscription.*'
    );

    await this.channel.bindQueue(
      configService.getQueueName(queues.kolManagement),
      commandsExchange,
      'kol.*'
    );

    await this.channel.bindQueue(
      configService.getQueueName(queues.serviceCommands),
      commandsExchange,
      'service.*'
    );

    // Bind outbound event queues to copy trade events exchange
    const eventsExchange = configService.getExchangeName(exchanges.copyTradeEvents);

    await this.channel.bindQueue(
      configService.getQueueName(queues.kolTradeDetected),
      eventsExchange,
      routingKeys.kolTradeDetected
    );

    await this.channel.bindQueue(
      configService.getQueueName(queues.copyTradeRequests),
      eventsExchange,
      routingKeys.copyTradeRequest
    );

    await this.channel.bindQueue(
      configService.getQueueName(queues.copyTradeCompleted),
      eventsExchange,
      routingKeys.copyTradeCompleted
    );

    // Bind notification queues
    const notificationsExchange = configService.getExchangeName(exchanges.notifications);
    
    await this.channel.bindQueue(
      configService.getQueueName(queues.clientNotifications),
      notificationsExchange,
      routingKeys.notification
    );

    await this.channel.bindQueue(
      configService.getQueueName(queues.serviceStatus),
      notificationsExchange,
      routingKeys.serviceStatus
    );

    // Bind dead letter queue
    const deadLetterExchange = configService.getExchangeName(exchanges.deadLetter);
    await this.channel.bindQueue(
      configService.getQueueName(queues.deadLetter),
      deadLetterExchange,
      '#' // Catch all failed messages
    );

    console.log('✅ Queue bindings setup complete');
  }

  /**
   * Start consuming messages from inbound queues
   */
  private async startConsumers(): Promise<void> {
    if (!this.channel) throw new Error('Channel not available');

    const { queues } = config.messaging;

    // Start consuming from inbound command queues
    const inboundQueues = [
      queues.subscriptionCommands,
      queues.kolManagement,
      queues.serviceCommands
    ];

    for (const queue of inboundQueues) {
      const queueName = configService.getQueueName(queue);
      
      await this.channel.consume(queueName, (msg) => {
        if (msg) {
          this.handleIncomingMessage(msg, queueName);
        }
      }, {
        noAck: false // Require explicit acknowledgment
      });

      console.log(`👂 Started consuming from: ${queueName}`);
    }
  }

  /**
   * Handle incoming messages
   */
  private async handleIncomingMessage(msg: amqp.Message, queueName: string): Promise<void> {
    try {
      const messageContent = msg.content.toString();
      const message: RabbitMQMessage = JSON.parse(messageContent);

      console.log(`📨 Received message: ${message.type} from ${queueName}`);

      // Find appropriate handler
      let handled = false;
      for (const handler of this.handlers.values()) {
        if (handler.canHandle(message)) {
          try {
            await handler.handle(message);
            handled = true;
            
            // Acknowledge successful processing
            this.channel?.ack(msg);
            console.log(`✅ Processed message: ${message.id}`);
            break;
          } catch (error:any) {
            console.error(`❌ Handler failed for message ${message.id}:`, error);
            
            // Check if we should retry
            if (message.retryCount < config.processing.retryAttempts) {
              await this.retryMessage(message, msg, error);
            } else {
              // Max retries exceeded - send to dead letter queue
              this.channel?.nack(msg, false, false);
              console.log(`💀 Message ${message.id} sent to dead letter queue (max retries exceeded)`);
            }
            handled = true;
            break;
          }
        }
      }

      if (!handled) {
        console.warn(`⚠️  No handler found for message type: ${message.type}`);
        // Acknowledge to prevent infinite redelivery
        this.channel?.ack(msg);
      }

    } catch (error) {
      console.error('Error processing message:', error);
      // Reject message and send to dead letter queue
      this.channel?.nack(msg, false, false);
    }
  }

  /**
   * Retry a failed message
   */
  private async retryMessage(message: RabbitMQMessage, originalMsg: amqp.Message, error: Error): Promise<void> {
    try {
      const retryMessage = {
        ...message,
        retryCount: message.retryCount + 1,
        timestamp: new Date()
      };

      // Delay before retry
      setTimeout(async () => {
        try {
          // Re-publish to same queue for retry
          const routingKey = originalMsg.fields.routingKey;
          const exchange = originalMsg.fields.exchange;
          
          await this.channel?.publish(
            exchange,
            routingKey,
            Buffer.from(JSON.stringify(retryMessage)),
            {
              persistent: true,
              messageId: retryMessage.id,
              timestamp: Date.now(),
              headers: {
                'x-message-type': retryMessage.type,
                'x-retry-count': retryMessage.retryCount.toString(),
                'x-original-error': error.message
              }
            }
          );

          console.log(`🔄 Retrying message ${message.id} (attempt ${retryMessage.retryCount})`);
        } catch (retryError) {
          console.error('Failed to retry message:', retryError);
        }
      }, config.processing.retryDelayMs * Math.pow(2, message.retryCount)); // Exponential backoff

      // Acknowledge original message
      this.channel?.ack(originalMsg);

    } catch (error) {
      console.error('Failed to setup message retry:', error);
      this.channel?.nack(originalMsg, false, false);
    }
  }

  /**
   * Handle connection errors
   */
  private handleConnectionError(error: Error): void {
    console.error('RabbitMQ connection error:', error);
    this.isConnected = false;
    
    if (!this.isShuttingDown) {
      this.attemptReconnection();
    }
  }

  /**
   * Handle connection close
   */
  private handleConnectionClose(): void {
    this.isConnected = false;
    
    if (!this.isShuttingDown) {
      this.attemptReconnection();
    }
  }

  /**
   * Attempt to reconnect with exponential backoff
   */
  private attemptReconnection(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('❌ Max reconnection attempts reached. Service will exit.');
      process.exit(1);
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000); // Max 30s
    this.reconnectAttempts++;

    console.log(`🔄 Reconnecting to RabbitMQ in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(async () => {
      try {
        await this.connect();
        await this.setupExchangesAndQueues();
        await this.startConsumers();
        
        console.log('✅ Reconnected to RabbitMQ');
        this.emit('reconnected');
      } catch (error) {
        console.error('Reconnection failed:', error);
        this.attemptReconnection();
      }
    }, delay);
  }

  /**
   * Setup graceful shutdown handling
   */
  private setupGracefulShutdown(): void {
    const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGUSR2'];
    
    signals.forEach(signal => {
      process.on(signal, async () => {
        console.log(`Received ${signal}, shutting down gracefully...`);
        await this.stop();
        process.exit(0);
      });
    });

    process.on('uncaughtException', async (error) => {
      console.error('Uncaught Exception:', error);
      await this.stop();
      process.exit(1);
    });

    process.on('unhandledRejection', async (reason) => {
      console.error('Unhandled Rejection:', reason);
      await this.stop();
      process.exit(1);
    });
  }

  /**
   * Get connection status
   */
  public isReady(): boolean {
    return this.isConnected && this.channel !== null;
  }

  /**
   * Get service metrics
   */
  public getMetrics() {
    return {
      connected: this.isConnected,
      handlersRegistered: this.handlers.size,
      reconnectAttempts: this.reconnectAttempts
    };
  }
} 