function cleanText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

const COLOR_DEFINITIONS = [
  {
    key: "black",
    label: "Black",
    pattern: /\bblack\b|\bjet\s+black\b|\bcharcoal\b|\bonyx\b/i,
    shades: [
      { key: "jet-black", label: "Jet Black", pattern: /\bjet\s+black\b/i },
      { key: "matte-black", label: "Matte Black", pattern: /\bmatte\s+black\b/i },
      { key: "charcoal-black", label: "Charcoal Black", pattern: /\bcharcoal\b/i }
    ]
  },
  {
    key: "white",
    label: "White",
    pattern: /\bwhite\b|\bivory\b|\bcream\b/i,
    shades: [
      { key: "cool-white", label: "Cool White", pattern: /\bcool\s+white\b/i },
      { key: "warm-white", label: "Warm White", pattern: /\bwarm\s+white\b/i },
      { key: "ivory-white", label: "Ivory White", pattern: /\bivory\b/i }
    ]
  },
  {
    key: "gray",
    label: "Gray",
    pattern: /\bgray\b|\bgrey\b|\bsilver\b|\bspace\s+gray\b/i,
    shades: [
      { key: "light-gray", label: "Light Gray", pattern: /\blight\s+gr[ae]y\b/i },
      { key: "dark-gray", label: "Dark Gray", pattern: /\bdark\s+gr[ae]y\b/i },
      { key: "space-gray", label: "Space Gray", pattern: /\bspace\s+gr[ae]y\b/i },
      { key: "silver-gray", label: "Silver Gray", pattern: /\bsilver\b/i }
    ]
  },
  {
    key: "blue",
    label: "Blue",
    pattern: /\bblue\b|\bnavy\b|\bsapphire\b|\bcyan\b|\bteal\b|\bsky\s+blue\b/i,
    shades: [
      { key: "light-blue", label: "Light Blue", pattern: /\blight\s+blue\b|\bsky\s+blue\b|\bbaby\s+blue\b/i },
      { key: "dark-blue", label: "Dark Blue", pattern: /\bdark\s+blue\b/i },
      { key: "navy-blue", label: "Navy Blue", pattern: /\bnavy\b/i },
      { key: "royal-blue", label: "Royal Blue", pattern: /\broyal\s+blue\b/i },
      { key: "teal-blue", label: "Teal Blue", pattern: /\bteal\b|\bcyan\b/i }
    ]
  },
  {
    key: "green",
    label: "Green",
    pattern: /\bgreen\b|\bolive\b|\bemerald\b|\bmint\b|\bforest\b|\blime\b/i,
    shades: [
      { key: "olive-green", label: "Olive Green", pattern: /\bolive\b|\barmy\s+green\b/i },
      { key: "light-green", label: "Light Green", pattern: /\blight\s+green\b|\bpastel\s+green\b/i },
      { key: "dark-green", label: "Dark Green", pattern: /\bdark\s+green\b|\bdeep\s+green\b/i },
      { key: "forest-green", label: "Forest Green", pattern: /\bforest\b|\bhunter\s+green\b/i },
      { key: "mint-green", label: "Mint Green", pattern: /\bmint\b/i },
      { key: "lime-green", label: "Lime Green", pattern: /\blime\b|\bneon\s+green\b/i },
      { key: "emerald-green", label: "Emerald Green", pattern: /\bemerald\b/i }
    ]
  },
  {
    key: "red",
    label: "Red",
    pattern: /\bred\b|\bmaroon\b|\bcrimson\b|\bburgundy\b/i,
    shades: [
      { key: "light-red", label: "Light Red", pattern: /\blight\s+red\b/i },
      { key: "dark-red", label: "Dark Red", pattern: /\bdark\s+red\b/i },
      { key: "crimson-red", label: "Crimson Red", pattern: /\bcrimson\b/i },
      { key: "burgundy-red", label: "Burgundy Red", pattern: /\bburgundy\b|\bmaroon\b/i }
    ]
  },
  {
    key: "yellow",
    label: "Yellow",
    pattern: /\byellow\b|\bgold\b|\bamber\b/i,
    shades: [
      { key: "light-yellow", label: "Light Yellow", pattern: /\blight\s+yellow\b/i },
      { key: "dark-yellow", label: "Dark Yellow", pattern: /\bdark\s+yellow\b|\bmustard\b/i },
      { key: "gold-yellow", label: "Gold", pattern: /\bgold\b/i },
      { key: "amber-yellow", label: "Amber", pattern: /\bamber\b/i }
    ]
  },
  {
    key: "orange",
    label: "Orange",
    pattern: /\borange\b|\bcopper\b/i,
    shades: [
      { key: "light-orange", label: "Light Orange", pattern: /\blight\s+orange\b|\bpeach\b/i },
      { key: "dark-orange", label: "Dark Orange", pattern: /\bdark\s+orange\b|\bburnt\s+orange\b/i },
      { key: "copper-orange", label: "Copper", pattern: /\bcopper\b/i }
    ]
  },
  {
    key: "purple",
    label: "Purple",
    pattern: /\bpurple\b|\bviolet\b|\blavender\b/i,
    shades: [
      { key: "light-purple", label: "Light Purple", pattern: /\blight\s+purple\b|\blavender\b/i },
      { key: "dark-purple", label: "Dark Purple", pattern: /\bdark\s+purple\b|\bdeep\s+purple\b/i },
      { key: "violet-purple", label: "Violet", pattern: /\bviolet\b/i }
    ]
  },
  {
    key: "pink",
    label: "Pink",
    pattern: /\bpink\b|\brose\b/i,
    shades: [
      { key: "light-pink", label: "Light Pink", pattern: /\blight\s+pink\b|\bpastel\s+pink\b/i },
      { key: "dark-pink", label: "Dark Pink", pattern: /\bdark\s+pink\b|\bhot\s+pink\b/i },
      { key: "rose-pink", label: "Rose Pink", pattern: /\brose\b/i }
    ]
  },
  {
    key: "brown",
    label: "Brown",
    pattern: /\bbrown\b|\bbronze\b|\bwood\b|\bchocolate\b/i,
    shades: [
      { key: "light-brown", label: "Light Brown", pattern: /\blight\s+brown\b|\btan\b/i },
      { key: "dark-brown", label: "Dark Brown", pattern: /\bdark\s+brown\b|\bchocolate\b/i },
      { key: "wood-brown", label: "Wood Brown", pattern: /\bwood\b/i },
      { key: "bronze-brown", label: "Bronze Brown", pattern: /\bbronze\b/i }
    ]
  },
  {
    key: "transparent",
    label: "Transparent",
    pattern: /\bclear\b|\btransparent\b|\btranslucent\b/i,
    shades: [
      { key: "clear-transparent", label: "Clear", pattern: /\bclear\b/i },
      { key: "frosted-transparent", label: "Frosted", pattern: /\bfrosted\b|\btranslucent\b/i }
    ]
  },
  {
    key: "multi-color",
    label: "Multi-Color",
    pattern: /\brainbow\b|\bmulti(?:-|\s)?color\b|\bmulti(?:-|\s)?colour\b|\bgalaxy\b|\bdual\s+color\b|\btri(?:-|\s)?color\b/i,
    shades: [
      { key: "rainbow-multi", label: "Rainbow", pattern: /\brainbow\b/i },
      { key: "galaxy-multi", label: "Galaxy", pattern: /\bgalaxy\b/i },
      { key: "dual-color-multi", label: "Dual Color", pattern: /\bdual\s+color\b/i },
      { key: "tri-color-multi", label: "Tri-Color", pattern: /\btri(?:-|\s)?color\b/i }
    ]
  }
];

function extractColorProfile(title) {
  const normalizedTitle = cleanText(title);

  for (const color of COLOR_DEFINITIONS) {
    if (!color.pattern.test(normalizedTitle)) {
      continue;
    }

    const shade = color.shades.find((entry) => entry.pattern.test(normalizedTitle));
    return {
      colorKey: color.key,
      colorLabel: color.label,
      shadeKey: shade ? shade.key : color.key,
      shadeLabel: shade ? shade.label : color.label
    };
  }

  return {
    colorKey: "other-colors",
    colorLabel: "Other Colors",
    shadeKey: "other-colors",
    shadeLabel: "Other Colors"
  };
}

module.exports = {
  COLOR_DEFINITIONS,
  extractColorProfile
};
