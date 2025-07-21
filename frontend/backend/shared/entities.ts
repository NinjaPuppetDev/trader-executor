import { Entity, PrimaryColumn, Column } from "typeorm";
import type { MarketRegime, BayesianRegressionResult } from "../types";

@Entity()
export class PriceDetectionLog {
    @PrimaryColumn()
    id!: string;

    @Column({ type: "varchar", default: "price-detections" })
    type!: string;

    @Column({ type: "int" }) // Added pairId
    pairId!: number;

    @Column({ type: "varchar" })
    timestamp!: string;

    @Column({ type: "text" })
    priceContext!: string;

    @Column({ type: "text" })
    decision!: string;

    @Column({ type: "int" })
    decisionLength!: number;

    @Column({ type: "varchar" })
    status!: string;

    @Column({ type: "varchar" })
    createdAt!: string;

    @Column({ type: "float" })
    spikePercent!: number;

    @Column({ type: "varchar" })
    eventTxHash!: string;

    @Column({ type: "int" })
    eventBlockNumber!: number;

    @Column({ type: "float", nullable: true })
    fgi!: number | null;

    @Column({ type: "varchar", nullable: true })
    fgiClassification!: string | null;

    @Column({ type: "varchar" })
    tokenIn!: string;

    @Column({ type: "varchar" })
    tokenOut!: string;

    @Column({ type: "varchar" })
    confidence!: string;

    @Column({ type: "varchar" })
    amount!: string;

    @Column({ type: "float", nullable: true })
    stopLoss!: number | null;

    @Column({ type: "float", nullable: true })
    takeProfit!: number | null;

    @Column({ type: "varchar", nullable: true })
    positionId!: string | null;

    @Column({ type: "varchar", nullable: true })
    tradeTxHash!: string | null;

    @Column({ type: "varchar", nullable: true })
    riskManagerTxHash!: string | null;

    @Column({ type: "varchar", nullable: true })
    entryPrice!: string | null;

    @Column({ type: "text", nullable: true })
    error!: string | null;

    @Column({ type: "json", nullable: true })
    bayesianAnalysis?: BayesianRegressionResult;

    @Column({ type: "varchar" })
    regime!: MarketRegime;

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

    @Column({ type: "int" }) // Added pairId
    pairId!: number;

    @Column({ type: "float", nullable: true }) // Added stopLoss
    stopLoss!: number | null;

    @Column({ type: "float", nullable: true }) // Added takeProfit
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

    @Column({ type: "varchar", nullable: true })
    entryPrice!: string | null;
}

@Entity()
export class ProcessedTrigger {
    @PrimaryColumn()
    id!: string;

    @Column({ type: "int" }) // Added pairId
    pairId!: number;
}

@Entity()
export class ApiDebugLog {
    @PrimaryColumn()
    id!: string;

    @Column({
        type: "varchar",
        default: () => "CURRENT_TIMESTAMP"  // Timestamp default
    })
    timestamp!: string;

    @Column({ type: "text" })
    prompt!: string;

    @Column({ type: "text", nullable: true })
    rawResponse?: string;

    @Column({ type: "text", nullable: true })
    parsedDecision?: string;

    @Column({ type: "text", nullable: true })
    error?: string;
}

@Entity()
export class RiskPosition {
    @PrimaryColumn()
    id: string;

    @Column()
    trader: string;

    @Column()
    isLong: boolean;

    @Column({ type: 'text' })
    amount: string;

    @Column({ type: 'text' })
    entryPrice: string;

    @Column()
    stopLoss: number;

    @Column()
    takeProfit: number;

    @Column({
        type: 'varchar',
        length: 20,
        default: 'active'
    })
    status: 'active' | 'closed' | 'liquidated';

    @Column({ type: 'datetime' })
    createdAt: Date;

    @Column({ type: 'datetime' })
    lastUpdated: Date;

    @Column({ type: 'datetime', nullable: true })
    closedAt: Date | null;

    @Column({ type: 'text', nullable: true })
    closedAmount: string | null;

    @Column({ type: 'text', nullable: true })
    closedReason: string | null;

    // Add metadata column - REMOVE THE DUPLICATE DECLARATION BELOW
    @Column({ type: 'text', nullable: true })
    metadata: string | null; // This is the only metadata declaration needed
}