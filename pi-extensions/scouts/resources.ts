import { DefaultResourceLoader, getAgentDir, type Skill } from "@mariozechner/pi-coding-agent";

type ResourceLoaderOptions = ConstructorParameters<typeof DefaultResourceLoader>[0];
type ScoutResourceLoaderOptions = Omit<ResourceLoaderOptions, "cwd" | "agentDir" | "noExtensions" | "noPromptTemplates" | "noThemes"> & {
  cwd: string;
  agentDir?: string;
  allowExtensions?: boolean;
};

export async function createScoutResourceLoader(
  options: ScoutResourceLoaderOptions,
): Promise<DefaultResourceLoader> {
  const { agentDir = getAgentDir(), allowExtensions = false, ...rest } = options;
  const resourceLoader = new DefaultResourceLoader({
    noExtensions: !allowExtensions,
    noPromptTemplates: true,
    noThemes: true,
    ...rest,
    agentDir,
  });
  await resourceLoader.reload();
  return resourceLoader;
}

export async function loadScoutSkills(cwd: string): Promise<Skill[]> {
  const resourceLoader = await createScoutResourceLoader({ cwd });
  return resourceLoader.getSkills().skills;
}
