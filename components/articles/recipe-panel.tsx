"use client";

import { AlertTriangle, Check, Code2, XCircle } from "lucide-react";
import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DIETS,
  recipeJsonLd,
  validateRecipe,
  type RecipeCard,
} from "@/lib/drafter/recipe";
import { cn } from "@/lib/utils";

/**
 * Recipe card → schema.org Recipe JSON-LD.
 *
 * Every field is typed by the author. Nothing is inferred from the draft and
 * nothing is generated, because structured data is a machine-readable factual
 * claim about a real dish — an invented cook time is a lie told to Google at
 * scale. Blank fields are simply left out of the output.
 */
export function RecipePanel({
  recipe,
  onChange,
  fallbackName,
  fallbackImage,
}: {
  recipe: RecipeCard;
  onChange: (next: RecipeCard) => void;
  /** Post title, offered as the recipe name. */
  fallbackName: string;
  /** Featured image, offered as the recipe image. */
  fallbackImage: string;
}) {
  const [showJson, setShowJson] = useState(false);

  const issues = useMemo(() => validateRecipe(recipe), [recipe]);
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const active = recipe.name.trim() !== "";

  const json = useMemo(
    () => JSON.stringify(recipeJsonLd(recipe) ?? {}, null, 2),
    [recipe],
  );

  const set = <K extends keyof RecipeCard>(key: K, value: RecipeCard[K]) => {
    onChange({ ...recipe, [key]: value });
  };

  const label = "mb-1 block text-xs font-medium text-muted-foreground";

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
        <p className="text-xs text-muted-foreground">
          Fills a schema.org <code className="rounded bg-muted px-1">Recipe</code>{" "}
          block on export. It powers Google&apos;s recipe rich result, the recipe
          carousel and AI Overviews. Leave the name blank and nothing is emitted.
        </p>
      </div>

      {active && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs",
            errors.length > 0
              ? "border-destructive/30 bg-destructive/5"
              : "border-success/40 bg-success/5",
          )}
        >
          {errors.length > 0 ? (
            <XCircle className="mt-px size-4 shrink-0 text-destructive" aria-hidden />
          ) : (
            <Check className="mt-px size-4 shrink-0 text-success" aria-hidden />
          )}
          <span>
            {errors.length > 0
              ? `${String(errors.length)} field${
                  errors.length === 1 ? "" : "s"
                } Google requires ${errors.length === 1 ? "is" : "are"} missing — no rich result until fixed.`
              : "Valid. This post can earn a recipe rich result."}
          </span>
        </div>
      )}

      {issues.length > 0 && (
        <ul className="space-y-1.5">
          {[...errors, ...warnings].map((issue) => (
            <li
              key={`${issue.field}-${issue.message}`}
              className="flex gap-2 text-xs text-muted-foreground"
            >
              {issue.severity === "error" ? (
                <XCircle className="mt-px size-3.5 shrink-0 text-destructive" aria-hidden />
              ) : (
                <AlertTriangle className="mt-px size-3.5 shrink-0 text-warning" aria-hidden />
              )}
              {issue.message}
            </li>
          ))}
        </ul>
      )}

      <div>
        <label className={label} htmlFor="recipe-name">
          Recipe name <span className="text-destructive">*</span>
        </label>
        <Input
          id="recipe-name"
          value={recipe.name}
          onChange={(e) => {
            set("name", e.target.value);
          }}
          placeholder="The recipe card title"
        />
        {recipe.name.trim() === "" && fallbackName.trim() !== "" && (
          <button
            type="button"
            onClick={() => {
              set("name", fallbackName);
            }}
            className="mt-1 text-xs font-medium text-primary hover:underline"
          >
            Use the post title
          </button>
        )}
      </div>

      {active && (
        <>
          <div>
            <label className={label} htmlFor="recipe-description">
              Description
            </label>
            <Textarea
              id="recipe-description"
              rows={2}
              value={recipe.description}
              onChange={(e) => {
                set("description", e.target.value);
              }}
            />
          </div>

          <div>
            <label className={label} htmlFor="recipe-image">
              Image URL <span className="text-destructive">*</span>
            </label>
            <Input
              id="recipe-image"
              value={recipe.imageUrl}
              onChange={(e) => {
                set("imageUrl", e.target.value);
              }}
              placeholder="https://…"
            />
            {recipe.imageUrl.trim() === "" && fallbackImage.trim() !== "" && (
              <button
                type="button"
                onClick={() => {
                  set("imageUrl", fallbackImage);
                }}
                className="mt-1 text-xs font-medium text-primary hover:underline"
              >
                Use the featured image
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label} htmlFor="recipe-yield">
                Yield <span className="text-destructive">*</span>
              </label>
              <Input
                id="recipe-yield"
                value={recipe.recipeYield}
                onChange={(e) => {
                  set("recipeYield", e.target.value);
                }}
                placeholder="How much it makes"
              />
            </div>
            <div>
              <label className={label} htmlFor="recipe-author">
                Author
              </label>
              <Input
                id="recipe-author"
                value={recipe.author}
                onChange={(e) => {
                  set("author", e.target.value);
                }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label} htmlFor="recipe-prep">
                Prep (minutes)
              </label>
              <Input
                id="recipe-prep"
                type="number"
                min={0}
                value={recipe.prepMinutes === 0 ? "" : recipe.prepMinutes}
                onChange={(e) => {
                  set("prepMinutes", Number(e.target.value) || 0);
                }}
              />
            </div>
            <div>
              <label className={label} htmlFor="recipe-cook">
                Cook (minutes)
              </label>
              <Input
                id="recipe-cook"
                type="number"
                min={0}
                value={recipe.cookMinutes === 0 ? "" : recipe.cookMinutes}
                onChange={(e) => {
                  set("cookMinutes", Number(e.target.value) || 0);
                }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label} htmlFor="recipe-category">
                Category
              </label>
              <Input
                id="recipe-category"
                value={recipe.category}
                onChange={(e) => {
                  set("category", e.target.value);
                }}
                placeholder="Course"
              />
            </div>
            <div>
              <label className={label} htmlFor="recipe-cuisine">
                Cuisine
              </label>
              <Input
                id="recipe-cuisine"
                value={recipe.cuisine}
                onChange={(e) => {
                  set("cuisine", e.target.value);
                }}
                placeholder="Cuisine"
              />
            </div>
          </div>

          <div>
            <label className={label} htmlFor="recipe-calories">
              Calories per serving
            </label>
            <Input
              id="recipe-calories"
              type="number"
              min={0}
              value={recipe.calories === 0 ? "" : recipe.calories}
              onChange={(e) => {
                set("calories", Number(e.target.value) || 0);
              }}
            />
          </div>

          <div>
            <label className={label} htmlFor="recipe-ingredients">
              Ingredients — one per line
            </label>
            <Textarea
              id="recipe-ingredients"
              rows={6}
              value={recipe.ingredients.join("\n")}
              onChange={(e) => {
                set(
                  "ingredients",
                  e.target.value.split("\n").map((l) => l.trimStart()),
                );
              }}
              placeholder="One ingredient per line, with its quantity"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Include the quantity and unit — &ldquo;2 cups flour&rdquo;, not
              &ldquo;flour&rdquo;.
            </p>
          </div>

          <div>
            <label className={label} htmlFor="recipe-steps">
              Method — one step per line
            </label>
            <Textarea
              id="recipe-steps"
              rows={6}
              value={recipe.steps.map((s) => s.text).join("\n")}
              onChange={(e) => {
                set(
                  "steps",
                  e.target.value
                    .split("\n")
                    .map((text) => ({ text: text.trimStart(), name: "" })),
                );
              }}
              placeholder="One step per line, in the order they are done"
            />
          </div>

          <fieldset>
            <legend className={label}>Suitable for</legend>
            <div className="flex flex-wrap gap-1.5">
              {DIETS.map((diet) => {
                const on = recipe.suitableForDiet.includes(diet);
                return (
                  <button
                    key={diet}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      set(
                        "suitableForDiet",
                        on
                          ? recipe.suitableForDiet.filter((d) => d !== diet)
                          : [...recipe.suitableForDiet, diet],
                      );
                    }}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                      on
                        ? "border-primary bg-primary/10 font-medium text-primary"
                        : "border-border text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {diet.replace(/Diet$/, "")}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div>
            <button
              type="button"
              onClick={() => {
                setShowJson((v) => !v);
              }}
              aria-expanded={showJson}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            >
              <Code2 className="size-3.5" aria-hidden />
              {showJson ? "Hide" : "Show"} the JSON-LD this produces
            </button>
            {showJson && (
              <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-[11px] leading-relaxed">
                {json}
              </pre>
            )}
          </div>
        </>
      )}
    </div>
  );
}
