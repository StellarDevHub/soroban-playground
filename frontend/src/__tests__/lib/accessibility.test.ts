import { LiveRegionManager, createFocusTrap } from '../../lib/accessibility';

describe('Accessibility Helpers', () => {
  let liveRegionManager: LiveRegionManager;

  beforeEach(() => {
    document.body.innerHTML = '';
    liveRegionManager = new LiveRegionManager();
  });

  it('creates and announces messages in the ARIA live region', (done) => {
    liveRegionManager.announce('Contract deployment succeeded', 'assertive');

    const region = document.getElementById('a11y-live-region');
    expect(region).not.toBeNull();
    expect(region?.getAttribute('aria-live')).toBe('assertive');

    setTimeout(() => {
      expect(region?.textContent).toBe('Contract deployment succeeded');
      done();
    }, 100);
  });

  it('sets up a focus trap within container elements', () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <button id="btn1">Button 1</button>
      <input id="input1" type="text" />
      <button id="btn2">Button 2</button>
    `;
    document.body.appendChild(container);

    const trap = createFocusTrap(container);
    const btn1 = document.getElementById('btn1') as HTMLElement;
    expect(document.activeElement).toBe(btn1);

    trap.release();
  });
});
