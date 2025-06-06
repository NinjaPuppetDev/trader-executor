// app/api/logs/route.ts
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic'; // Ensure dynamic response

export async function GET() {
    const LOG_FILE = path.join(process.cwd(), 'backend', 'logs', 'venice-logs.json');

    try {
        if (!fs.existsSync(LOG_FILE)) {
            return NextResponse.json([]);
        }

        const fileData = fs.readFileSync(LOG_FILE, 'utf-8');
        const logs = JSON.parse(fileData);
        return NextResponse.json(logs);
    } catch (err) {
        console.error('Error reading logs:', err);
        return NextResponse.json(
            { error: 'Failed to load logs' },
            { status: 500 }
        );
    }
}