'use client';

import { ApolloProvider } from '@apollo/client/react';
import { client } from '../../lib/apollo';
import { ReactNode } from 'react';

export function GraphQLProvider({ children }: { children: ReactNode }) {
  return (
    <ApolloProvider client={client}>
      {children}
    </ApolloProvider>
  );
}
