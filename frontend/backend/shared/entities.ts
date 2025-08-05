import { Entity, PrimaryGeneratedColumn, PrimaryColumn, Column } from "typeorm";
import type { MarketRegime, BayesianRegressionResult } from "../types";

@Entity()
export class PriceDetectionLog {
    @PrimaryColumn({ type: 'varchar' })
    id!: string;

    @Column({ type: 'varchar', default: 'price-detections' })
    type!: string;

    @Column({ type: 'int' })
    pairId!: number;

    @Column({ type: 'varchar' })
    timestamp!: string;

    @Column({ type: 'text' })
    priceContext!: string;

    @Column({ type: 'text' })
    decision!: string;

    @Column({ type: 'int' })
    decisionLength!: number;

    @Column({ type: 'varchar' })
    status!: string;

    @Column({ type: 'varchar' })
    createdAt!: string;

    @Column({ type: 'float' })
    spikePercent!: number;

    @Column({ type: 'varchar' })
    eventTxHash!: string;

    @Column({ type: 'int' })
    eventBlockNumber!: number;

    @Column({ type: 'float', nullable: true })
    fgi!: number | null;

    @Column({ type: 'varchar', nullable: true })
    fgiClassification!: string | null;

    @Column({ type: 'varchar' })
    tokenIn!: string;

    @Column({ type: 'varchar' })
    tokenOut!: string;

    @Column({ type: 'varchar' })
    confidence!: string;

    @Column({ type: 'varchar' })
    amount!: string;

    @Column({ type: 'float', nullable: true })
    stopLoss!: number | null;

    @Column({ type: 'float', nullable: true })
    takeProfit!: number | null;

    @Column({ type: 'varchar', nullable: true })
    positionId!: string | null;

    @Column({ type: 'varchar', nullable: true })
    tradeTxHash!: string | null;

    @Column({ type: 'varchar', nullable: true })
    riskManagerTxHash!: string | null;

    @Column({ type: 'text', nullable: true })
    error!: string | null;

    @Column({ type: 'json', nullable: true })
    bayesianAnalysis!: BayesianRegressionResult | null;

    @Column({ type: 'varchar' })
    regime!: MarketRegime;

    // Updated to nullable
    @Column({ type: 'float', nullable: true })
    currentPrice!: number | null;

    @Column({ type: 'varchar' })
    positionAction!: 'open' | 'close' | 'adjust' | 'hold';

    // New fields for cluster analysis
    @Column({ type: 'int', nullable: true }) 
    clusterSize!: number | null;

     @Column({ type: 'float', nullable: true }) // Changed to nullable
    clusterVolatility!: number | null;

     @Column({ type: 'json', nullable: true }) // Changed to nullable
    clusterSpikes!: number[] | null;

    @Column({ type: 'boolean', default: false })
    positionConflict!: boolean;
}

@Entity()
export class TradeExecutionLog {
    @PrimaryColumn()
    id!: string;

    @Column({ type: "varchar", default: "trade-execution" })
    source!: string;

    @Column({ type: "varchar" })
    timestamp!: string;

    @Column({ type: "varchar" })
    sourceLogId!: string;

    @Column({ type: "varchar", default: "price-detections" })
    sourceType!: string;

    @Column({ type: "text" })
    decision!: string;

    @Column({ type: "varchar" })
    status!: string;

    @Column({ type: "varchar" })
    createdAt!: string;

    @Column({ type: "varchar" })
    tokenIn!: string;

    @Column({ type: "varchar" })
    tokenOut!: string;

    @Column({ type: "varchar" })
    amount!: string;

    @Column({ type: "int" })
    tokenInDecimals!: number;

    @Column({ type: "int" })
    tokenOutDecimals!: number;

    @Column({ type: "int" })
    pairId!: number;

    @Column({ type: "float", nullable: true })
    stopLoss!: number | null;

    @Column({ type: "float", nullable: true })
    takeProfit!: number | null;

    @Column({ type: "varchar", nullable: true })
    amountIn!: string | null;

    @Column({ type: "varchar", nullable: true })
    minAmountOut!: string | null;

    @Column({ type: "varchar", nullable: true })
    actualAmountOut!: string | null;

    @Column({ type: "varchar", nullable: true })
    txHash!: string | null;

    @Column({ type: "varchar", nullable: true })
    gasUsed!: string | null;

    @Column({ type: "text", nullable: true })
    error!: string | null;

    @Column({ type: "varchar", default: "trade-execution" })
    type!: string;

    @Column({ type: "varchar", nullable: true })
    positionId!: string | null;

    // New field for position sizing context
    @Column({ type: "float" })
    sizeMultiplier!: number;

    @Column({ type: "float", nullable: true })
    executionPrice!: number | null;

}


@Entity()
export class ProcessedTrigger {
    @PrimaryColumn()
    id!: string;

    @Column({ type: "int" })
    pairId!: number;
}

@Entity()
export class ApiDebugLog {
    @PrimaryColumn()
    id!: string;

    @Column({ type: "varchar", default: () => "CURRENT_TIMESTAMP" })
    timestamp!: string;

    @Column({ type: "text" })
    prompt!: string;

    @Column({ type: "text", nullable: true })
    rawResponse!: string | null;

    @Column({ type: "text", nullable: true })
    parsedDecision!: string | null;

    @Column({ type: "text", nullable: true })
    error!: string | null;

    // New field for cluster context
    @Column({ type: "json", nullable: true })
    clusterContext!: any;
}


@Entity()
export class RiskPosition {
    @PrimaryColumn()
    id!: string;

    @Column()
    trader!: string;

    @Column()
    isLong!: boolean;

    @Column({ type: 'text' })
    amount!: string;

    @Column({ type: 'text' })
    entryPrice!: string;

    @Column()
    stopLoss!: number;

    @Column()
    takeProfit!: number;

    @Column({ type: 'varchar', length: 20, default: 'active' })
    status!: 'active' | 'closed' | 'liquidated';

    @Column({ type: 'datetime' })
    createdAt!: Date;

    @Column({ type: 'datetime' })
    lastUpdated!: Date;

    @Column({ type: 'datetime', nullable: true })
    closedAt!: Date | null;

    @Column({ type: 'text', nullable: true })
    closedAmount!: string | null;

    @Column({ type: 'text', nullable: true })
    closedReason!: string | null;

    @Column({ type: 'text', nullable: true })
    metadata!: string | null;
}

@Entity()
export class Position {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ type: 'int' })
    pairId!: number;
    

    @Column({ type: 'varchar' })
    symbol!: string;

    @Column({ type: 'varchar' })
    openedAt!: string;

    @Column({ type: 'varchar', nullable: true })
    closedAt!: string | null;

    @Column({ type: 'float' })
    openPrice!: number;

    @Column({ type: 'float', nullable: true })
    closePrice!: number | null;

    @Column({ type: 'varchar' })
    direction!: 'long' | 'short';

    @Column({ type: 'float' })
    amount!: number;

    @Column({ type: 'float' })
    stopLoss!: number;

    @Column({ type: 'float' })
    takeProfit!: number;

    @Column({ type: 'varchar', default: 'open' })
    status!: 'open' | 'closed' | 'liquidated';

    @Column({ type: 'float', nullable: true })
    pnl!: number | null;

    @Column({ type: 'varchar', nullable: true })
    closeReason!: 'stop_loss' | 'take_profit' | 'signal_close' | 'liquidated' | 'manual' | null;

    @Column({ type: 'varchar', nullable: true })
    openDetectionId!: string | null;

    @Column({ type: 'varchar', nullable: true })
    closeDetectionId!: string | null;

    // New fields for enhanced monitoring
    @Column({ type: 'float' })
    currentPriceAtOpen!: number;

    @Column({ type: 'float', nullable: true })
    maxDrawdown!: number | null;

    @Column({ type: 'float', nullable: true })
    maxProfit!: number | null;

    @Column({ type: 'int', default: 0 })
    adjustmentCount!: number;

    // New field for position sizing context
    @Column({ type: 'float' })
    sizeMultiplier!: number;
}