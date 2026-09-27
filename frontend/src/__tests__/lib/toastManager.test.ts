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

  it('groups duplicate event notifications when groupId is supplied', () => {
    const id1 = toastManager.show({ title: 'Build started', groupId: 'build-process' });
    const id2 = toastManager.show({ title: 'Build updated', groupId: 'build-process' });

    expect(id1).toBe(id2);
    const toasts = toastManager.getToasts();
    expect(toasts.length).toBe(1);
    expect(toasts[0].groupCount).toBe(2);
    expect(toasts[0].title).toBe('Build updated');
  });

  it('dismisses a toast manually', () => {
    const id = toastManager.show({ title: 'Test Toast' });
    expect(toastManager.getToasts().length).toBe(1);

    toastManager.dismiss(id);
    expect(toastManager.getToasts().length).toBe(0);
  });
});
