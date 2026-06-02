const { Project } = require("ts-morph");
const fs = require('fs');

const project = new Project({
  tsConfigFilePath: "tsconfig.json",
});

const sourceFiles = project.getSourceFiles("src/**/*.tsx");

sourceFiles.forEach(sourceFile => {
  // Add export keyword to main function
  const functions = sourceFile.getFunctions();
  functions.forEach(func => {
    if (func.getName() && !func.isExported() && func.getName() !== 'App') {
      func.setIsExported(true);
    }
  });

  // Automatically remove unused imports
  sourceFile.fixUnusedIdentifiers();
  
  // Format
  sourceFile.formatText();
  sourceFile.saveSync();
});

console.log("Auto-fixed exports and unused imports!");
