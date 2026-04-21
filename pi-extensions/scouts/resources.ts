import { DefaultResourceLoader, type Skill } from "@mariozechner/pi-coding-agent";

type ResourceLoaderOptions = ConstructorParameters<typeof DefaultResourceLoader>[0];
type IsolatedScoutResourceLoaderOptions = Omit<ResourceLoaderOptions, "cwd" | "noExtensions" | "noPromptTemplates" | "noThemes"> & {
  cwd: string;
};

export async function createScoutResourceLoader(
  options: IsolatedScoutResourceLoaderOptions,
): Promise<DefaultResourceLoader> {
  const resourceLoader = new DefaultResourceLoader({
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    ...options,
  });
  await resourceLoader.reload();
  return resourceLoader;
}

export async function loadScoutSkills(cwd: string): Promise<Skill[]> {
  const resourceLoader = await createScoutResourceLoader({ cwd });
  return resourceLoader.getSkills().skills;
}
