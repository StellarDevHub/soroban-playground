import { ToastManager } from '../../lib/toastManager';

describe('ToastManager', () => {
  let toastManager: ToastManager;

  beforeEach(() => {
    toastManager = new ToastManager();
  });

  afterEach(() => {
    toastManager.clear();
  });

  it('adds and retrieves prioritized toast notifications', () => {
    toastManager.show({ title: 'Low priority', priority: 'low' });
    toastManager.show({ title: 'Critical priority', priority: 'critical' });

    const toasts = toastManager.getToasts();
    expect(toasts.length).toBe(2);
    expect(toasts[0].title).toBe('Critical priority');
  });

  it('enforces max visible queue limit of 3 concurrent toasts', () => {
    toastManager.show({ title: 'Low 1', priority: 'low' });
    toastManager.show({ title: 'Medium 1', priority: 'medium' });
    toastManager.show({ title: 'High 1', priority: 'high' });
    toastManager.show({ title: 'Critical 1', priority: 'critical' });

    const visibleToasts = toastManager.getToasts();
    expect(visibleToasts.length).toBe(3);
    // Highest priority should be visible first
    expect(visibleToasts[0].title).toBe('Critical 1');
    expect(visibleToasts[1].title).toBe('High 1');
    expect(visibleToasts[2].title).toBe('Medium 1');

    // All toasts still tracked in queue
    const allToasts = toastManager.getAllToasts();
    expect(allToasts.length).toBe(4);
  });

  it('promotes the next queued toast when a visible toast is dismissed', () => {
    const idCritical = toastManager.show({ title: 'Critical', priority: 'critical' });
    toastManager.show({ title: 'High', priority: 'high' });
    toastManager.show({ title: 'Medium', priority: 'medium' });
    toastManager.show({ title: 'Low queued', priority: 'low' });

    // Initially, Low queued is not among the top 3
    let visible = toastManager.getToasts();
    expect(visible.map((t) => t.title)).not.toContain('Low queued');

    // Dismiss the critical toast
    toastManager.dismiss(idCritical);

    // Now Low queued enters visible window
    visible = toastManager.getToasts();
    expect(visible.length).toBe(3);
    expect(visible.map((t) => t.title)).toContain('Low queued');
  });

  it('groups duplicate event notifications when groupId is supplied', () => {
    const id1 = toastManager.show({ title: 'Build started', groupId: 'build-process' });
    const id2 = toastManager.show({ title: 'Build updated', groupId: 'build-process' });

    expect(id1).toBe(id2);
    const toasts = toastManager.getToasts();
    expect(toasts.length).toBe(1);
    expect(toasts[0].groupCount).toBe(2);
    expect(toasts[0].title).toBe('Build updated');
  });

  it('automatically groups duplicate error messages even without an explicit groupId', () => {
    const errId1 = toastManager.show({
      title: 'Simulation Failed',
      message: 'Host function invocation trapped',
      type: 'error',
    });
    const errId2 = toastManager.show({
      title: 'Simulation Failed',
      message: 'Host function invocation trapped',
      type: 'error',
    });

    expect(errId1).toBe(errId2);
    const toasts = toastManager.getToasts();
    expect(toasts.length).toBe(1);
    expect(toasts[0].groupCount).toBe(2);
  });

  it('supports sound cue enable/disable accessibility toggle', () => {
    expect(toastManager.isSoundEnabled()).toBe(true);
    toastManager.setSoundEnabled(false);
    expect(toastManager.isSoundEnabled()).toBe(false);

    // Should not throw when playing sound cue while disabled
    expect(() => toastManager.playSoundCue('success')).not.toThrow();
    expect(() => toastManager.playSoundCue('error')).not.toThrow();
  });

  it('dismisses a toast manually', () => {
    const id = toastManager.show({ title: 'Test Toast' });
    expect(toastManager.getToasts().length).toBe(1);

    toastManager.dismiss(id);
    expect(toastManager.getToasts().length).toBe(0);
  });
});
