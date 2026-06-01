import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import IdentityPortal, { type IdentityData } from '../../components/IdentityPortal';

const identities: IdentityData[] = [
  {
    owner: 'GABC1234567890',
    did: 'did:soroban:GABC1234567890',
    metadataHash: 1,
    reputation: 10,
    active: true,
    credentials: [],
  },
];

function renderPortal(
  overrides: Partial<ComponentProps<typeof IdentityPortal>> = {}
) {
  return render(
    <IdentityPortal
      contractId={'C'.repeat(56)}
      walletAddress="GDEMO4MV6L6QY6P4UQBW5SC4R6X4P7WALLET"
      identities={identities}
      isLoading={false}
      onRegister={jest.fn()}
      onUpdateMetadata={jest.fn()}
      onDeactivate={jest.fn()}
      onIssueCredential={jest.fn()}
      onRevokeCredential={jest.fn()}
      onAdjustReputation={jest.fn()}
      {...overrides}
    />
  );
}

describe('IdentityPortal', () => {
  it('rejects invalid metadata hashes during onboarding', async () => {
    const onRegister = jest.fn();
    renderPortal({ onRegister });

    fireEvent.click(screen.getByRole('button', { name: /^register$/i }));
    fireEvent.change(screen.getByLabelText(/did string/i), {
      target: { value: 'did:soroban:test' },
    });
    fireEvent.change(screen.getByLabelText(/metadata hash/i), {
      target: { value: '-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /register identity/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/metadata hash must be a whole number/i);
    expect(onRegister).not.toHaveBeenCalled();
  });

  it('rejects empty reputation deltas before calling the handler', () => {
    const onAdjustReputation = jest.fn();
    renderPortal({ onAdjustReputation });

    fireEvent.click(screen.getByRole('button', { name: /did:soroban:gabc1234567890/i }));
    fireEvent.change(screen.getByLabelText(/reputation delta/i), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^apply$/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/reputation delta must be a non-zero whole number/i);
    expect(onAdjustReputation).not.toHaveBeenCalled();
  });
});
