import * as Y from 'yjs';

describe('Yjs concurrent editing convergence', () => {
  it('converges simultaneous text edits when updates are applied in different orders', () => {
    const base = new Y.Doc();
    const textBase = base.getText('source');

    const left = new Y.Doc();
    Y.applyUpdate(left, Y.encodeStateAsUpdate(base));
    const leftText = left.getText('source');

    const right = new Y.Doc();
    Y.applyUpdate(right, Y.encodeStateAsUpdate(base));
    const rightText = right.getText('source');

    leftText.insert(0, 'left');
    rightText.insert(0, 'right');

    const leftUpdate = Y.encodeStateAsUpdate(left);
    const rightUpdate = Y.encodeStateAsUpdate(right);

    Y.applyUpdate(base, leftUpdate);
    Y.applyUpdate(base, rightUpdate);

    const replayA = new Y.Doc();
    Y.applyUpdate(replayA, leftUpdate);
    Y.applyUpdate(replayA, rightUpdate);

    const replayB = new Y.Doc();
    Y.applyUpdate(replayB, rightUpdate);
    Y.applyUpdate(replayB, leftUpdate);

    expect(replayA.getText('source').toString()).toBe(base.getText('source').toString());
    expect(replayB.getText('source').toString()).toBe(base.getText('source').toString());
  });

  it('preserves independent insertions made by multiple developers', () => {
    const server = new Y.Doc();
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    Y.applyUpdate(docA, Y.encodeStateAsUpdate(server));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(server));

    docA.getText('source').insert(0, 'fn alpha() {}\n');
    docB.getText('source').insert(0, 'fn beta() {}\n');

    const updateA = Y.encodeStateAsUpdate(docA);
    const updateB = Y.encodeStateAsUpdate(docB);

    Y.applyUpdate(server, updateA);
    Y.applyUpdate(server, updateB);

    const finalText = server.getText('source').toString();
    expect(finalText).toContain('fn alpha() {}');
    expect(finalText).toContain('fn beta() {}');

    const reconnect = new Y.Doc();
    Y.applyUpdate(reconnect, Y.encodeStateAsUpdate(server));
    expect(reconnect.getText('source').toString()).toBe(finalText);
  });
});
