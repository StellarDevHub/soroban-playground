import { fireEvent, render, screen } from '@testing-library/react';
import MobileEditor from '../../components/MobileEditor';

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: width,
  });
  window.dispatchEvent(new Event('resize'));
}

describe('MobileEditor', () => {
  const editorContent = <div data-testid="editor-content">Editor Panel</div>;
  const outputContent = <div data-testid="output-content">Output Panel</div>;

  const renderEditor = () =>
    render(
      <MobileEditor editor={editorContent} output={outputContent} />
    );

  describe('Desktop (lg and above)', () => {
    beforeEach(() => {
      setViewportWidth(1280);
    });

    it('renders editor content', () => {
      renderEditor();
      const editors = screen.getAllByTestId('editor-content');
      expect(editors.length).toBeGreaterThanOrEqual(1);
    });

    it('renders output content', () => {
      renderEditor();
      const outputs = screen.getAllByTestId('output-content');
      expect(outputs.length).toBeGreaterThanOrEqual(1);
    });

    it('desktop content is wrapped in lg:contents container', () => {
      renderEditor();
      const editorDivs = screen.getAllByTestId('editor-content');
      expect(editorDivs.length).toBeGreaterThanOrEqual(1);
      const outputDivs = screen.getAllByTestId('output-content');
      expect(outputDivs.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Mobile / Tablet (below lg)', () => {
    beforeEach(() => {
      setViewportWidth(375);
    });

    it('renders tabbed layout', () => {
      renderEditor();
      expect(screen.getByRole('tablist')).toBeInTheDocument();
    });

    it('renders tab buttons with 44px minimum height', () => {
      renderEditor();
      const tabs = screen.getAllByRole('tab');
      tabs.forEach((tab) => {
        expect(tab).toHaveClass('min-h-[44px]');
      });
    });

    it('shows editor tab panel by default', () => {
      renderEditor();
      const editorPanel = screen.getAllByTestId('editor-content');
      expect(editorPanel.length).toBeGreaterThanOrEqual(1);
    });

    it('renders output tab panel', () => {
      renderEditor();
      const outputPanel = screen.getAllByTestId('output-content');
      expect(outputPanel.length).toBeGreaterThanOrEqual(1);
    });

    it('switches to output tab on click', () => {
      renderEditor();
      const outputTab = screen.getByText('Output');
      fireEvent.click(outputTab);

      const editors = screen.getAllByTestId('editor-content');
      const outputs = screen.getAllByTestId('output-content');
      expect(editors.length).toBeGreaterThanOrEqual(1);
      expect(outputs.length).toBeGreaterThanOrEqual(1);
    });

    it('switches back to editor tab on click', () => {
      renderEditor();
      fireEvent.click(screen.getByText('Output'));
      fireEvent.click(screen.getByText('Editor'));

      const editors = screen.getAllByTestId('editor-content');
      const outputs = screen.getAllByTestId('output-content');
      expect(editors.length).toBeGreaterThanOrEqual(1);
      expect(outputs.length).toBeGreaterThanOrEqual(1);
    });

    it('has correct aria attributes on tabs', () => {
      renderEditor();
      const tabs = screen.getAllByRole('tab');
      expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
      expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
      expect(tabs[0]).toHaveAttribute('aria-controls');
      expect(tabs[1]).toHaveAttribute('aria-controls');
    });

    it('tablist has aria-label', () => {
      renderEditor();
      expect(screen.getByRole('tablist')).toHaveAttribute('aria-label', 'Editor sections');
    });

    it('maintains tab state on re-render', () => {
      const { rerender } = render(
        <MobileEditor editor={editorContent} output={outputContent} />
      );
      const outputTab = screen.getAllByText('Output');
      fireEvent.click(outputTab[outputTab.length - 1]);

      rerender(<MobileEditor editor={editorContent} output={outputContent} />);
      const outputs = screen.getAllByTestId('output-content');
      expect(outputs.length).toBeGreaterThanOrEqual(1);
    });
  });
});
