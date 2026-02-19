---
name: shadcn-svelte-forms
description: Use when building forms with shadcn-svelte or bits-ui. Covers Field.* component patterns, checkbox groups, radio groups, form validation display. Prevents raw divs, wrong Label imports, inconsistent form structure.
---

# shadcn-svelte Form Patterns

## Field.* Components — Always Use Them

Never use raw `<div>` or import `Label` directly for form structure. Always use Field.* components:

```svelte
import * as Field from "$lib/components/ui/field/index.js";
```

### Basic Structure

```svelte
<Field.Group>
  <Field.Field>
    <Field.Label for="email">Email</Field.Label>
    <Input id="email" name="email" />
    <Field.Error>Error message</Field.Error>
  </Field.Field>
</Field.Group>
```

### Grouped Options (Checkboxes, Radios)

**This is the pattern that matters most.** Each option gets `Field.Label` wrapping `Field.Field`:

```svelte
<Field.Set>
  <Field.Label>Events</Field.Label>
  <div class="grid gap-2">
    {#each options as option (option.id)}
      <Field.Label for="option-{option.id}">
        <Field.Field orientation="horizontal" class="justify-between hover:bg-muted/50">
          <div class="flex flex-col gap-0.5">
            <span class="text-sm font-medium">{option.label}</span>
            <span class="text-xs text-muted-foreground">{option.description}</span>
          </div>
          <Checkbox
            id="option-{option.id}"
            name="options"
            value={option.id}
            checked={selected.includes(option.id)}
            onCheckedChange={(checked) => toggle(option.id, checked === true)}
          />
        </Field.Field>
      </Field.Label>
    {/each}
  </div>
  <Field.Error>Select at least one</Field.Error>
</Field.Set>
```

### Radio Group (same pattern)

```svelte
<Field.Set>
  <Field.Label>Expiration</Field.Label>
  <RadioGroup.Root bind:value={expiration} class="grid grid-cols-3 gap-2">
    {#each options as opt (opt.value)}
      <Field.Label for="exp-{opt.value}">
        <Field.Field orientation="horizontal" class="justify-center hover:bg-muted/50">
          <RadioGroup.Item value={opt.value} id="exp-{opt.value}" class="sr-only" />
          <span class="text-sm font-medium">{opt.label}</span>
        </Field.Field>
      </Field.Label>
    {/each}
  </RadioGroup.Root>
</Field.Set>
```

## Component Reference

| Component | Purpose |
|-----------|---------|
| `Field.Group` | Wraps entire form, provides consistent spacing |
| `Field.Field` | Single form field container (border, padding, states) |
| `Field.Set` | Groups related fields (like fieldset) |
| `Field.Label` | Label element, also makes parent clickable |
| `Field.Error` | Validation error display |
| `Field.Description` | Helper text below field |

## Common Mistakes

❌ **Wrong: Raw div + Label import**
```svelte
import { Label } from "$lib/components/ui/label/index.js";

<div class="flex items-center gap-3">
  <Checkbox id="foo" />
  <Label for="foo">Option</Label>
</div>
```

✅ **Right: Field.Label + Field.Field**
```svelte
<Field.Label for="foo">
  <Field.Field orientation="horizontal">
    <span>Option</span>
    <Checkbox id="foo" />
  </Field.Field>
</Field.Label>
```

❌ **Wrong: Custom border/padding classes**
```svelte
<div class="rounded-lg border bg-muted/30 px-4 py-3">
```

✅ **Right: Let Field.Field handle styling**
```svelte
<Field.Field orientation="horizontal" class="hover:bg-muted/50">
```

## Reference

For full API and more examples, see [references/field.md](references/field.md).
