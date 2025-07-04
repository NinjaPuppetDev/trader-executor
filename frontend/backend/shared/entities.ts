import { Entity, PrimaryColumn, Column } from "typeorm";

@Entity()
export class PriceDetectionLog {
    @PrimaryColumn()
    id!: string;

    @Column({ type: "varchar", default: "price-detections" })
    type!: string;

    @Column({
        type: "varchar",
        default: () => "CURRENT_TIMESTAMP"  // Default for event timestamp
    })
    timestamp!: string;

    @Column({ type: "text" })
    priceContext!: string;

    @Column({ type: "text", nullable: true })
    decision!: string | null;

    @Column({ type: "int", default: 0 })
    decisionLength!: number;

    @Column({ type: "varchar", default: "pending" })
    status!: string;

    @Column({
        type: "varchar",
        default: () => "CURRENT_TIMESTAMP"  // Default for creation time
    })
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

    @Column({ type: "varchar", default: "medium" })
    confidence!: string;

    @Column({ type: "varchar" })
    amount!: string;

    @Column({ type: "text", nullable: true })
    error!: string | null;


}

@Entity()
export class TradeExecutionLog {
    @PrimaryColumn()
    id!: string;

    @Column({ type: "varchar", default: "trade-execution" })
    source!: string;

    @Column({
        type: "varchar",
        default: () => "CURRENT_TIMESTAMP"  // Event timestamp
    })
    timestamp!: string;

    @Column({ type: "varchar" })
    sourceLogId!: string;

    @Column({
        type: "varchar",
        default: "price-detections"  // Default source type
    })
    sourceType!: string;

    @Column({ type: "text" })
    decision!: string;

    @Column({ type: "varchar" })
    status!: string;

    @Column({
        type: "varchar",
        default: () => "CURRENT_TIMESTAMP"  // Creation time
    })
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
}

@Entity()
export class ProcessedTrigger {
    @PrimaryColumn()
    id!: string;
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