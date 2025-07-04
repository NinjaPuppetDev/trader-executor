"use client";
import { ReactNode, useMemo } from "react";
import { TokenMetadataProvider } from "../contexts/TokenMetadataContext";
import { ApolloClient, ApolloProvider, InMemoryCache, HttpLink } from "@apollo/client";

export default function ClientRoot({ children }: { children: ReactNode }) {
    const apolloClient = useMemo(() => {
        const httpLink = new HttpLink({
            uri: process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:4000/graphql',
            // Add headers if needed for authentication
            headers: {
                'Content-Type': 'application/json',
            }
        });

        return new ApolloClient({
            link: httpLink,
            cache: new InMemoryCache(),
            defaultOptions: {
                watchQuery: {
                    fetchPolicy: 'cache-and-network',
                },
                query: {
                    fetchPolicy: 'network-only',
                },
            },
        });
    }, []);

    return (
        <ApolloProvider client={apolloClient}>
            <TokenMetadataProvider>
                {children}
            </TokenMetadataProvider>
        </ApolloProvider>
    );
}