// app/api/last-update/route.ts
import { NextResponse } from 'next/server';

let lastPriceUpdate = Date.now();
let lastTradeUpdate = Date.now();

export function GET() {
    return NextResponse.json({
        lastPriceUpdate,
        lastTradeUpdate
    });
}

export function POST(request: Request) {
    const url = new URL(request.url);
    const type = url.searchParams.get('type') || 'price';

    if (type === 'price') {
        lastPriceUpdate = Date.now();
    } else {
        lastTradeUpdate = Date.now();
    }

    return new Response(null, { status: 204 });
}