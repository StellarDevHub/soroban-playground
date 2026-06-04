import { fireEvent, render, screen } from "@testing-library/react";
import TemplateCard from "../../components/TemplateCard";
import type { TemplateData } from "../../components/TemplateCard";

const sampleTemplate: TemplateData = {
  id: "hello-world",
  name: "Hello World",
  category: "utility",
  description: "Minimal Soroban contract that returns a greeting.",
  tags: ["hello", "example"],
  path: "contracts/hello-world",
  code: `#![no_std]\n\nuse soroban_sdk::{contract, contractimpl, Env, String};`,
};

describe("TemplateCard", () => {
  it("renders name, category, and description", () => {
    render(
      <TemplateCard
        template={sampleTemplate}
        isFavorite={false}
        onToggleFavorite={jest.fn()}
      />
    );

    expect(screen.getByText("Hello World")).toBeInTheDocument();
    expect(screen.getByText("utility")).toBeInTheDocument();
    expect(
      screen.getByText("Minimal Soroban contract that returns a greeting.")
    ).toBeInTheDocument();
  });

  it("has role='article' and correct aria-label", () => {
    render(
      <TemplateCard
        template={sampleTemplate}
        isFavorite={false}
        onToggleFavorite={jest.fn()}
      />
    );

    const article = screen.getByRole("article");
    expect(article).toHaveAttribute("aria-label", "Template: Hello World");
  });

  it("shows filled star when favorited and calls handler on toggle", () => {
    const onToggle = jest.fn();

    const { rerender } = render(
      <TemplateCard
        template={sampleTemplate}
        isFavorite={true}
        onToggleFavorite={onToggle}
      />
    );

    const favButton = screen.getByRole("button", {
      name: "Remove from favorites",
    });
    expect(favButton).toBeInTheDocument();

    fireEvent.click(favButton);
    expect(onToggle).toHaveBeenCalledWith("hello-world");

    rerender(
      <TemplateCard
        template={sampleTemplate}
        isFavorite={false}
        onToggleFavorite={onToggle}
      />
    );

    expect(
      screen.getByRole("button", { name: "Add to favorites" })
    ).toBeInTheDocument();
  });

  it("renders code snippet preview", () => {
    render(
      <TemplateCard
        template={sampleTemplate}
        isFavorite={false}
        onToggleFavorite={jest.fn()}
      />
    );

    const codeBlock = screen.getByText((content) =>
      content.includes("#![no_std]")
    );
    expect(codeBlock).toBeInTheDocument();
  });

  it("renders a link to the playground with template id", () => {
    render(
      <TemplateCard
        template={sampleTemplate}
        isFavorite={false}
        onToggleFavorite={jest.fn()}
      />
    );

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/playground?template=hello-world");
  });
});
