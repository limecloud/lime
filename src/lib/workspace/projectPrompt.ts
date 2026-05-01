/**
 * 项目提示词生成工具
 *
 * 根据项目 Memory 生成系统提示词
 */

import type {
  ProjectMemory,
  Character,
  WorldBuilding,
  OutlineNode,
} from "@/lib/api/memory";

const DEFAULT_CHARACTER_NAME = "默认主角";
const DEFAULT_OUTLINE_TITLE = "第一章";

function normalizeText(value?: string): string {
  return typeof value === "string" ? value.trim() : "";
}

function isPlaceholderText(value?: string): boolean {
  const normalized = normalizeText(value);
  return !normalized || normalized.includes("待补充");
}

function isUsefulText(value?: string): boolean {
  return !isPlaceholderText(value);
}

function hasUsefulCharacterContent(character: Character): boolean {
  if (
    character.aliases.some(isUsefulText) ||
    isUsefulText(character.description) ||
    isUsefulText(character.personality) ||
    isUsefulText(character.background) ||
    isUsefulText(character.appearance)
  ) {
    return true;
  }

  return (
    isUsefulText(character.name) &&
    normalizeText(character.name) !== DEFAULT_CHARACTER_NAME
  );
}

function normalizeCharacter(character: Character): Character {
  return {
    ...character,
    name: normalizeText(character.name),
    aliases: character.aliases.filter(isUsefulText).map(normalizeText),
    description: isUsefulText(character.description)
      ? normalizeText(character.description)
      : undefined,
    personality: isUsefulText(character.personality)
      ? normalizeText(character.personality)
      : undefined,
    background: isUsefulText(character.background)
      ? normalizeText(character.background)
      : undefined,
    appearance: isUsefulText(character.appearance)
      ? normalizeText(character.appearance)
      : undefined,
  };
}

function normalizeWorldBuilding(
  worldBuilding?: WorldBuilding,
): WorldBuilding | null {
  if (!worldBuilding) {
    return null;
  }

  const normalized: WorldBuilding = {
    ...worldBuilding,
    description: isUsefulText(worldBuilding.description)
      ? normalizeText(worldBuilding.description)
      : "",
    era: isUsefulText(worldBuilding.era)
      ? normalizeText(worldBuilding.era)
      : undefined,
    locations: isUsefulText(worldBuilding.locations)
      ? normalizeText(worldBuilding.locations)
      : undefined,
    rules: isUsefulText(worldBuilding.rules)
      ? normalizeText(worldBuilding.rules)
      : undefined,
  };

  return normalized.description ||
    normalized.era ||
    normalized.locations ||
    normalized.rules
    ? normalized
    : null;
}

function hasUsefulOutlineNode(node: OutlineNode): boolean {
  const usefulTitle = isUsefulText(node.title);
  const usefulContent = isUsefulText(node.content);
  if (usefulContent) {
    return true;
  }
  return usefulTitle && normalizeText(node.title) !== DEFAULT_OUTLINE_TITLE;
}

function normalizeOutlineNode(node: OutlineNode): OutlineNode {
  return {
    ...node,
    title: isUsefulText(node.title) ? normalizeText(node.title) : "未命名章节",
    content: isUsefulText(node.content)
      ? normalizeText(node.content)
      : undefined,
  };
}

/**
 * 生成角色提示词
 */
function generateCharactersPrompt(characters: Character[]): string {
  if (characters.length === 0) return "";

  let prompt = "### 角色设定\n\n";

  const mainCharacters = characters.filter((character) => character.is_main);
  const sideCharacters = characters.filter((character) => !character.is_main);

  if (mainCharacters.length > 0) {
    prompt += "**主要角色：**\n";
    mainCharacters.forEach((character) => {
      prompt += `- **${character.name}**`;
      if (character.aliases.length > 0) {
        prompt += `（${character.aliases.join("、")}）`;
      }
      prompt += "\n";
      if (character.description) {
        prompt += `  - 简介：${character.description}\n`;
      }
      if (character.personality) {
        prompt += `  - 性格：${character.personality}\n`;
      }
      if (character.background) {
        prompt += `  - 背景：${character.background}\n`;
      }
      if (character.appearance) {
        prompt += `  - 外貌：${character.appearance}\n`;
      }
    });
    prompt += "\n";
  }

  if (sideCharacters.length > 0) {
    prompt += "**次要角色：**\n";
    sideCharacters.forEach((character) => {
      prompt += `- **${character.name}**`;
      if (character.description) {
        prompt += `：${character.description}`;
      }
      prompt += "\n";
    });
    prompt += "\n";
  }

  return prompt;
}

/**
 * 生成世界观提示词
 */
function generateWorldBuildingPrompt(worldBuilding: WorldBuilding): string {
  let prompt = "### 世界观设定\n\n";

  if (worldBuilding.description) {
    prompt += `${worldBuilding.description}\n\n`;
  }

  if (worldBuilding.era) {
    prompt += `**时代背景：** ${worldBuilding.era}\n\n`;
  }

  if (worldBuilding.locations) {
    prompt += `**主要地点：** ${worldBuilding.locations}\n\n`;
  }

  if (worldBuilding.rules) {
    prompt += `**世界规则：** ${worldBuilding.rules}\n\n`;
  }

  return prompt;
}

/**
 * 生成大纲提示词
 */
function generateOutlinePrompt(outline: OutlineNode[]): string {
  if (outline.length === 0) return "";

  let prompt = "### 故事大纲\n\n";
  const sortedOutline = [...outline].sort(
    (left, right) => left.order - right.order,
  );
  const outlineIds = new Set(sortedOutline.map((node) => node.id));
  const rootNodes = sortedOutline.filter(
    (node) => !node.parent_id || !outlineIds.has(node.parent_id),
  );

  const renderNode = (node: OutlineNode, level = 0): string => {
    const indent = "  ".repeat(level);
    let result = `${indent}- **${node.title}**`;
    if (node.content) {
      result += `：${node.content}`;
    }
    result += "\n";

    const children = sortedOutline.filter(
      (candidate) => candidate.parent_id === node.id,
    );
    children.forEach((child) => {
      result += renderNode(child, level + 1);
    });

    return result;
  };

  rootNodes.forEach((node) => {
    prompt += renderNode(node);
  });

  return prompt + "\n";
}

/**
 * 生成项目 Memory 提示词
 */
export function generateProjectMemoryPrompt(memory: ProjectMemory): string {
  const characters = memory.characters
    .filter(hasUsefulCharacterContent)
    .map(normalizeCharacter);
  const worldBuilding = normalizeWorldBuilding(memory.world_building);
  const outline = memory.outline
    .filter(hasUsefulOutlineNode)
    .map(normalizeOutlineNode);

  if (characters.length === 0 && !worldBuilding && outline.length === 0) {
    return "";
  }

  let prompt = "## 项目背景\n\n";

  if (characters.length > 0) {
    prompt += generateCharactersPrompt(characters);
  }

  if (worldBuilding) {
    prompt += generateWorldBuildingPrompt(worldBuilding);
  }

  if (outline.length > 0) {
    prompt += generateOutlinePrompt(outline);
  }

  return prompt.trim();
}
