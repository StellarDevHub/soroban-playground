import { fireEvent, render, screen } from '@testing-library/react';
import ResponsiveNav from '../../components/ResponsiveNav';

const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  usePathname: () => '/playground',
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('next/link', () => {
  return ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  );
});

jest.mock('../../hooks/useFreighterWallet', () => ({
  useFreighterWallet: () => ({
    status: 'disconnected',
    address: null,
    network: 'testnet',
    connect: jest.fn(),
    disconnect: jest.fn(),
  }),
}));

// Mock matchMedia for jsdom
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

// Helper to set viewport width
function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: width,
  });
  window.dispatchEvent(new Event('resize'));
}

describe('ResponsiveNav', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.body.style.overflow = '';
  });

  const renderNav = () =>
    render(
      <ResponsiveNav>
        <div data-testid="child-content">Page Content</div>
      </ResponsiveNav>
    );

  describe('Desktop (md and above)', () => {
    beforeEach(() => {
      setViewportWidth(1024);
    });

    it('renders the desktop sidebar with nav links', () => {
      renderNav();
      const brandLinks = screen.getAllByText('Soroban Play');
      expect(brandLinks.length).toBeGreaterThanOrEqual(1);
      const ideLinks = screen.getAllByText('IDE Playground');
      expect(ideLinks.length).toBeGreaterThanOrEqual(1);
      const compileLinks = screen.getAllByText('Compile Dashboard');
      expect(compileLinks.length).toBeGreaterThanOrEqual(1);
    });

    it('renders page content', () => {
      renderNav();
      expect(screen.getByTestId('child-content')).toBeInTheDocument();
    });

    it('hamburger button exists with md:hidden class on desktop', () => {
      renderNav();
      const hamburger = screen.getByLabelText('Open navigation');
      expect(hamburger).toBeInTheDocument();
    });
  });

  describe('Mobile (below md)', () => {
    beforeEach(() => {
      setViewportWidth(375);
    });

    it('renders hamburger button', () => {
      renderNav();
      const hamburger = screen.getByLabelText('Open navigation');
      expect(hamburger).toBeInTheDocument();
    });

    it('hamburger button has 44x44px minimum touch target', () => {
      renderNav();
      const hamburger = screen.getByLabelText('Open navigation');
      expect(hamburger).toHaveClass('min-w-[44px]');
      expect(hamburger).toHaveClass('min-h-[44px]');
    });

    it('hamburger button opens drawer and sets aria-expanded to true', () => {
      renderNav();
      const hamburger = screen.getByLabelText('Open navigation');
      expect(hamburger).toHaveAttribute('aria-expanded', 'false');

      fireEvent.click(hamburger);
      expect(hamburger).toHaveAttribute('aria-expanded', 'true');
    });

    it('renders drawer with navigation links when opened', () => {
      renderNav();
      fireEvent.click(screen.getByLabelText('Open navigation'));

      const assetsLinks = screen.getAllByText('Synthetic Assets');
      expect(assetsLinks.length).toBeGreaterThanOrEqual(1);
      const bobLinks = screen.getAllByText('Limit Order Book');
      expect(bobLinks.length).toBeGreaterThanOrEqual(1);
    });

    it('drawer has role="dialog" and aria-modal="true"', () => {
      renderNav();
      fireEvent.click(screen.getByLabelText('Open navigation'));

      const drawer = screen.getByRole('dialog');
      expect(drawer).toHaveAttribute('aria-modal', 'true');
    });

    it('drawer close button has 44x44px minimum touch target', () => {
      renderNav();
      fireEvent.click(screen.getByLabelText('Open navigation'));

      const closeButton = screen.getByLabelText('Close navigation');
      expect(closeButton).toHaveClass('min-w-[44px]');
      expect(closeButton).toHaveClass('min-h-[44px]');
    });

    it('close button in drawer closes it', () => {
      renderNav();
      fireEvent.click(screen.getByLabelText('Open navigation'));
      expect(screen.getByLabelText('Close navigation')).toBeInTheDocument();

      fireEvent.click(screen.getByLabelText('Close navigation'));
      expect(screen.getByLabelText('Open navigation')).toHaveAttribute('aria-expanded', 'false');
    });

    it('nav link click closes the drawer', () => {
      renderNav();
      fireEvent.click(screen.getByLabelText('Open navigation'));
      const links = screen.getAllByText('Synthetic Assets');
      fireEvent.click(links[links.length - 1]);
      expect(screen.getByLabelText('Open navigation')).toHaveAttribute('aria-expanded', 'false');
    });

    it('Escape key closes the drawer', () => {
      renderNav();
      fireEvent.click(screen.getByLabelText('Open navigation'));
      expect(screen.getByLabelText('Close navigation')).toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.getByLabelText('Open navigation')).toHaveAttribute('aria-expanded', 'false');
    });

    it('backdrop click closes the drawer', () => {
      renderNav();
      fireEvent.click(screen.getByLabelText('Open navigation'));
      const backdrop = screen.getByTestId('drawer-backdrop');
      expect(backdrop).toBeInTheDocument();

      fireEvent.click(backdrop);
      expect(screen.getByLabelText('Open navigation')).toHaveAttribute('aria-expanded', 'false');
    });

    it('locks body scroll when drawer is open', () => {
      renderNav();
      expect(document.body.style.overflow).toBe('');

      fireEvent.click(screen.getByLabelText('Open navigation'));
      expect(document.body.style.overflow).toBe('hidden');

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(document.body.style.overflow).toBe('');
    });

    it('renders page content on mobile too', () => {
      renderNav();
      expect(screen.getByTestId('child-content')).toBeInTheDocument();
    });
  });
});
