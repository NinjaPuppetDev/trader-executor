// contexts/TokenMetadataContext.tsx
'use client';
import React, { createContext, useContext, useEffect, useState } from 'react';

interface TokenMetadata {
    symbol: string;
    decimals: number;
    name: string;
}

interface TokenMetadataContextType {
    metadata: Record<string, TokenMetadata>;
    getTokenMetadata: (address: string) => TokenMetadata | undefined;
}

const TokenMetadataContext = createContext<TokenMetadataContextType>({
    metadata: {},
    getTokenMetadata: () => undefined
});

export function TokenMetadataProvider({ children }: { children: React.ReactNode }) {
    const [metadata, setMetadata] = useState<Record<string, TokenMetadata>>({});

    useEffect(() => {
        let isActive = true;

        const fetchMetadata = async () => {
            try {
                // In a real app, you'd fetch this from an API
                const staticMetadata: Record<string, TokenMetadata> = {
                    '0xe7f1725e7734ce288f8367e1bb143e90bb3f0512': {
                        symbol: 'STABLE',
                        decimals: 18,
                        name: 'Stable Token'
                    },
                    '0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0': {
                        symbol: 'VOL',
                        decimals: 18,
                        name: 'Volatile Token'
                    }
                };
                if (isActive) {
                    setMetadata(staticMetadata);
                }
            } catch (error) {
                console.error('Failed to load token metadata:', error);
            }
        };

        fetchMetadata();

        return () => {
            isActive = false;
        };
    }, []);
    const getTokenMetadata = (address: string) => {
        const normalized = address.toLowerCase();
        return metadata[normalized];
    };

    return (
        <TokenMetadataContext.Provider value={{ metadata, getTokenMetadata }}>
            {children}
        </TokenMetadataContext.Provider>
    );
}

export const useTokenMetadata = () => useContext(TokenMetadataContext);