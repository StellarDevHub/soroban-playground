import { fireEvent, render, screen } from '@testing-library/react';
import CallPanel from '../../components/CallPanel';

describe('CallPanel', () => {
  it('shows a validation message for invalid JSON arguments', () => {
    const onInvoke = jest.fn();

    render(
      <CallPanel
        onInvoke={onInvoke}
        isInvoking={false}
        contractId={'C'.repeat(56)}
      />
    );

    fireEvent.change(screen.getByLabelText(/arguments \(json\)/i), {
      target: { value: '{ invalid json' },
    });
    fireEvent.change(screen.getByLabelText(/function name/i), {
      target: { value: 'hello' },
    });
    fireEvent.click(screen.getByRole('button', { name: /invoke function/i }));

    expect(screen.getByText(/arguments must be valid json/i)).toBeInTheDocument();
    expect(onInvoke).not.toHaveBeenCalled();
  });

  it('invokes the contract with trimmed function names and parsed arguments', () => {
    const onInvoke = jest.fn();

    render(
      <CallPanel
        onInvoke={onInvoke}
        isInvoking={false}
        contractId={'C'.repeat(56)}
      />
    );

    fireEvent.change(screen.getByLabelText(/function name/i), {
      target: { value: '  hello  ' },
    });
    fireEvent.change(screen.getByLabelText(/arguments \(json\)/i), {
      target: { value: '{"name":"Ayomide"}' },
    });
    fireEvent.click(screen.getByRole('button', { name: /invoke function/i }));

    expect(onInvoke).toHaveBeenCalledWith('hello', { name: 'Ayomide' });
  });
});
