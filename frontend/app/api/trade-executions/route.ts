import { NextResponse } from 'next/server';
import path from 'path';
import { promises as fs } from 'fs';

export const dynamic = 'force-dynamic';

export async function GET() {
    const logsDir = path.join(process.cwd(), 'backend', 'logs');
    const filePath = path.join(logsDir, 'trade-executions.json');

    try {
        const fileContents = await fs.readFile(filePath, 'utf8');
        const logs = JSON.parse(fileContents);
        return NextResponse.json(logs);
    } catch (error) {
        return NextResponse.json(
            { error: 'Unable to load trade executions' },
            { status: 500 }
        );
    }
}