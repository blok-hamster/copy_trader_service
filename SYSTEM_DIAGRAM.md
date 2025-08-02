# Solana Copy Trading System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           SOLANA COPY TRADING SYSTEM                                 │
└─────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────┐    ┌─────────────────────────────────────────────────────┐
│     SOLANA BLOCKCHAIN   │    │                CLIENT LAYER                         │
│                         │    │                                                     │
│  ┌─────────────────────┐│    │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │   KOL WALLETS       ││    │  │   WEB APP   │  │ MOBILE APP  │  │   DESKTOP   │ │
│  │  (Being Watched)    ││    │  │             │  │             │  │     APP     │ │
│  │                     ││    │  └─────────────┘  └─────────────┘  └─────────────┘ │
│  │  - Wallet A         ││    │           │              │              │          │
│  │  - Wallet B         ││    │           └──────────────┼──────────────┘          │
│  │  - Wallet C         ││    │                          │                         │
│  └─────────────────────┘│    │                    WebSocket Connection             │
│           │              │    └─────────────────────────────────────────────────────┘
│           │ TX Events    │                               │
│           ▼              │                               │
│  ┌─────────────────────┐ │                               ▼
│  │   SOLANA RPC/WSS    │ │    ┌─────────────────────────────────────────────────────┐
│  │     ENDPOINT        │ │    │              COPY TRADER SERVICE                     │
│  └─────────────────────┘ │    │                                                     │
└─────────────────────────┘    │ ┌─────────────────────────────────────────────────┐ │
           │                    │ │            CORE SERVICES                        │ │
           │ Real-time          │ │                                                 │ │
           │ WebSocket          │ │ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ │ │
           ▼                    │ │ │ BLOCKCHAIN  │ │    TRADE    │ │SUBSCRIPTION │ │ │
┌─────────────────────────┐     │ │ │  LISTENER   │ │  DETECTOR   │ │  MANAGER    │ │ │
│   BLOCKCHAIN LISTENER   │────▶│ │ │  SERVICE    │ │   SERVICE   │ │   SERVICE   │ │ │
│                         │     │ │ └─────────────┘ └─────────────┘ └─────────────┘ │ │
│ - WebSocket to Solana   │     │ │        │              │              │         │ │
│ - Real-time TX monitor  │     │ │        │              │              │         │ │
│ - Parse swap events     │     │ │        ▼              ▼              ▼         │ │
│ - Filter KOL trades     │     │ │ ┌─────────────────────────────────────────────┐ │ │
└─────────────────────────┘     │ │ │          TRADE REPLICATION SERVICE         │ │ │
           │                    │ │ │                                             │ │ │
           │ Detected Trade     │ │ │ - Match trades to subscriptions             │ │ │
           ▼                    │ │ │ - Calculate copy trade amounts              │ │ │
┌─────────────────────────┐     │ │ │ - Queue trades for execution                │ │ │
│      RABBITMQ           │     │ │ └─────────────────────────────────────────────┘ │ │
│                         │     │ │        │                          ▲             │ │
│ ┌─────────────────────┐ │     │ │        │                          │             │ │
│ │  TRADE EVENTS       │ │     │ │        ▼                          │             │ │
│ │   EXCHANGE          │ │     │ │ ┌─────────────────────────────────────────────┐ │ │
│ │                     │ │     │ │ │         NOTIFICATION SERVICE                │ │ │
│ │ - KOL Trade Queue   │ │     │ │ │                                             │ │ │
│ │ - Copy Trade Queue  │ │     │ │ │ - WebSocket Server                          │ │ │
│ │ - Notification Qu.  │ │     │ │ │ - Real-time client updates                  │ │ │
│ └─────────────────────┘ │     │ │ │ - Trade status notifications                │ │ │
│           │              │     │ │ └─────────────────────────────────────────────┘ │ │
│           │ Publishes    │     │ └─────────────────────────────────────────────────┘ │
│           ▼              │     └─────────────────────────────────────────────────────┘
│ ┌─────────────────────┐ │                    │
│ │   CONSUMERS         │ │                    │ Delegated to
│ │                     │ │                    ▼ existing service
│ │ - Trade Processor   │ │     ┌─────────────────────────────────────────────────────┐
│ │ - Notification Pub. │ │     │              SOLANA SWAP SERVICE                     │
│ │ - Copy Executor     │ │     │                                                     │
│ └─────────────────────┘ │     │ ┌─────────────────────────────────────────────────┐ │
└─────────────────────────┘     │ │                TRADE EXECUTION                  │ │
           │                    │ │                                                 │ │
           │ Send to swap       │ │ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ │ │
           │ service via        │ │ │   HIGH      │ │   MEDIUM    │ │    LOW      │ │ │
           │ RabbitMQ           │ │ │  PRIORITY   │ │  PRIORITY   │ │  PRIORITY   │ │ │
           ▼                    │ │ │   QUEUE     │ │   QUEUE     │ │   QUEUE     │ │ │
┌─────────────────────────┐     │ │ └─────────────┘ └─────────────┘ └─────────────┘ │ │
│     REDIS CACHE         │     │ │        │              │              │         │ │
│                         │     │ │        └──────────────┼──────────────┘         │ │
│ ┌─────────────────────┐ │     │ │                       │                        │ │
│ │  SUBSCRIPTION DATA  │ │     │ │                       ▼                        │ │
│ │                     │ │     │ │ ┌─────────────────────────────────────────────┐ │ │
│ │ - User -> KOL maps  │ │     │ │ │            TRADE WORKERS                    │ │ │
│ │ - Real-time state   │ │     │ │ │                                             │ │ │
│ │ - Session data      │ │     │ │ │ - Execute actual swaps                      │ │ │
│ │ - Notification pub  │ │     │ │ │ - Monitor positions                         │ │ │
│ └─────────────────────┘ │     │ │ │ - Handle retries and failures               │ │ │
└─────────────────────────┘     │ │ └─────────────────────────────────────────────┘ │ │
           ▲                    │ └─────────────────────────────────────────────────┘ │
           │ Cache lookups      └─────────────────────────────────────────────────────┘
           │ & updates
           │
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              DATA FLOW                                               │
│                                                                                       │
│ 1. KOL executes trade → Solana blockchain                                            │
│ 2. Blockchain Listener detects TX → Parse trade details                              │
│ 3. Trade published to RabbitMQ → Trade Events Exchange                               │
│ 4. Trade Replication Service consumes → Check subscriptions in Redis                 │
│ 5. Generate copy trades → Send to Solana Swap Service queues                         │
│ 6. Swap Service executes → Returns status via RabbitMQ                               │
│ 7. Notification Service → Push updates to WebSocket clients                          │
│                                                                                       │
└─────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              KEY FEATURES                                            │
│                                                                                       │
│ ✅ Real-time KOL trade detection (sub-second)                                        │
│ ✅ Scalable pub/sub architecture with RabbitMQ                                       │
│ ✅ Fast subscription lookups with Redis                                              │
│ ✅ Automatic fan-out to multiple copy traders                                        │
│ ✅ Priority-based trade execution                                                    │
│ ✅ Real-time client notifications via WebSocket                                      │
│ ✅ Integration with existing Solana Swap Service                                     │
│ ✅ Horizontal scaling across multiple instances                                      │
│                                                                                       │
└─────────────────────────────────────────────────────────────────────────────────────┘ 