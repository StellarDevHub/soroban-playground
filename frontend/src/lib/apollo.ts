import { ApolloClient, InMemoryCache, HttpLink, ApolloLink, from } from '@apollo/client';
import { map } from 'rxjs';

const httpLink = new HttpLink({
  uri: process.env.NEXT_PUBLIC_GRAPHQL_ENDPOINT || 'http://localhost:5000/graphql',
});

// Optional: Add a logging link for debugging DataLoader batching
const loggingLink = new ApolloLink((operation, forward) => {
  console.log(`[GraphQL Request]: ${operation.operationName}`);
  return forward(operation).pipe(
    map((response) => {
      console.log(`[GraphQL Response]: ${operation.operationName}`, response.data);
      return response;
    })
  );
});

export const client = new ApolloClient({
  link: from([loggingLink, httpLink]),
  cache: new InMemoryCache(),
  defaultOptions: {
    watchQuery: {
      fetchPolicy: 'cache-and-network',
    },
  },
});
