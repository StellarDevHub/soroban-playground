import { fireEvent, render, screen } from "@testing-library/react";
import TemplateSearchBar from "../../components/TemplateSearchBar";

describe("TemplateSearchBar", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders input and result count", () => {
    render(
      <TemplateSearchBar value="" onChange={jest.fn()} resultCount={42} />
    );

    expect(
      screen.getByLabelText("Search contract templates")
    ).toBeInTheDocument();
    expect(screen.getByText("42 templates found")).toBeInTheDocument();
  });

  it("uses singular 'template' when result count is 1", () => {
    render(
      <TemplateSearchBar value="" onChange={jest.fn()} resultCount={1} />
    );

    expect(screen.getByText("1 template found")).toBeInTheDocument();
  });

  it("debounces onChange by 200ms", () => {
    const onChange = jest.fn();
    render(
      <TemplateSearchBar value="" onChange={onChange} resultCount={0} />
    );

    const input = screen.getByLabelText("Search contract templates");
    fireEvent.change(input, { target: { value: "hello" } });

    // onChange should not have been called yet (debounced)
    expect(onChange).not.toHaveBeenCalled();

    jest.advanceTimersByTime(200);

    expect(onChange).toHaveBeenCalledWith("hello");
  });

  it("shows clear button when input is non-empty and clears on click", () => {
    const onChange = jest.fn();
    render(
      <TemplateSearchBar value="hello" onChange={onChange} resultCount={0} />
    );

    const clearButton = screen.getByLabelText("Clear search");
    expect(clearButton).toBeInTheDocument();

    fireEvent.click(clearButton);
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("does not show clear button when input is empty", () => {
    render(
      <TemplateSearchBar value="" onChange={jest.fn()} resultCount={0} />
    );

    expect(screen.queryByLabelText("Clear search")).not.toBeInTheDocument();
  });

  it("has aria-live polite region for result count", () => {
    render(
      <TemplateSearchBar value="" onChange={jest.fn()} resultCount={24} />
    );

    const liveRegion = screen.getByText("24 templates found");
    expect(liveRegion).toHaveAttribute("aria-live", "polite");
  });

  it("has label associated via htmlFor", () => {
    render(
      <TemplateSearchBar value="" onChange={jest.fn()} resultCount={0} />
    );

    const input = screen.getByLabelText("Search contract templates");
    const label = screen.getByText("Search templates");
    expect(label).toHaveAttribute("for", "template-search");
    expect(input).toHaveAttribute("id", "template-search");
  });
});
