import { render, screen } from '@testing-library/react';
import DeployPanel from '../../components/DeployPanel';

describe('DeployPanel', () => {
  it('disables deploy until compilation succeeds', () => {
    render(
      <DeployPanel
        onCompile={jest.fn()}
        onDeploy={jest.fn()}
        isCompiling={false}
        isDeploying={false}
        hasCompiled={false}
      />
    );

    expect(screen.getByRole('button', { name: /compile/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /deploy to testnet/i })).toBeDisabled();
  });

  it('shows compile and deploy status details', () => {
    render(
      <DeployPanel
        onCompile={jest.fn()}
        onDeploy={jest.fn()}
        isCompiling={false}
        isDeploying={false}
        hasCompiled
        compileSummary="Compiled successfully"
        contractId={'C'.repeat(56)}
      />
    );

    expect(screen.getByText(/active contract id/i)).toBeInTheDocument();
    expect(screen.getByText(/compiled successfully/i)).toBeInTheDocument();
  });
});
