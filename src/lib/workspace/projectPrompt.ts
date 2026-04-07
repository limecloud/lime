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
  const rootNodes = sortedOutline.filter((node) => !node.parent_id);

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
  let prompt = "## 项目背景\n\n";

  if (memory.characters.length > 0) {
    prompt += generateCharactersPrompt(memory.characters);
  }

  if (memory.world_building?.description) {
    prompt += generateWorldBuildingPrompt(memory.world_building);
  }

  if (memory.outline.length > 0) {
    prompt += generateOutlinePrompt(memory.outline);
  }

  return prompt.trim();
}
