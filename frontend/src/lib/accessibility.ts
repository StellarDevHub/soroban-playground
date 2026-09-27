export type Politeness = 'polite' | 'assertive';

export class LiveRegionManager {
  private liveRegion: HTMLElement | null = null;

  constructor() {
    if (typeof document !== 'undefined') {
      this.ensureLiveRegion();
    }
  }

  private ensureLiveRegion(): void {
    let region = document.getElementById('a11y-live-region');
    if (!region) {
      region = document.createElement('div');
      region.id = 'a11y-live-region';
      region.setAttribute('aria-live', 'polite');
      region.setAttribute('aria-atomic', 'true');
      region.className = 'sr-only';
      region.style.position = 'absolute';
      region.style.width = '1px';
      region.style.height = '1px';
      region.style.overflow = 'hidden';
      region.style.clip = 'rect(0, 0, 0, 0)';
      document.body.appendChild(region);
    }
    this.liveRegion = region;
  }

  public announce(message: string, politeness: Politeness = 'polite'): void {
    if (typeof document === 'undefined') return;
    this.ensureLiveRegion();
    if (!this.liveRegion) return;

    this.liveRegion.setAttribute('aria-live', politeness);
    this.liveRegion.textContent = '';
    // Small delay triggers screen reader notification on content change
    setTimeout(() => {
      if (this.liveRegion) {
        this.liveRegion.textContent = message;
      }
    }, 50);
  }
}

export const liveRegionManager = new LiveRegionManager();

export function announceToScreenReader(message: string, politeness: Politeness = 'polite'): void {
  liveRegionManager.announce(message, politeness);
}

export function createFocusTrap(container: HTMLElement): { release: () => void } {
  const focusableSelectors = [
    'a[href]',
    'area[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'button:not([disabled])',
    'iframe',
    'object',
    'embed',
    '[contenteditable]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  const focusableElements = Array.from(
    container.querySelectorAll<HTMLElement>(focusableSelectors)
  );

  const firstFocusable = focusableElements[0];
  const lastFocusable = focusableElements[focusableElements.length - 1];

  if (firstFocusable) {
    firstFocusable.focus();
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;

    if (e.shiftKey) {
      if (document.activeElement === firstFocusable) {
        e.preventDefault();
        lastFocusable?.focus();
      }
    } else {
      if (document.activeElement === lastFocusable) {
        e.preventDefault();
        firstFocusable?.focus();
      }
    }
  };

  container.addEventListener('keydown', handleKeyDown);

  return {
    release: () => {
      container.removeEventListener('keydown', handleKeyDown);
    },
  };
}
