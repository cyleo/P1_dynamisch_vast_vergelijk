module.exports = function(fileInfo, api) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  const globals = [
    "energyData", "overviewMode", "overviewMetric", "activeViewType",
    "sankeyInterval", "sankeyValue", "simMode", "simDrillDay", "activeSimulation",
    "profileVisibleLines", "epexHistory", "liveEnergyTax", "_lastHAStats",
    "_lastRoleMap", "digitalTwinEnabled", "isDemoData", "fullYearData",
    "fullYearStamp", "yearScale", "dataMeta", "epexWarnDismissed",
    "prognosisDismissed", "dataQualityDismissed", "calibratedProfile", "calibrationMeta"
  ];

  // 1. Remove the 'let' declarations of these globals
  root.find(j.VariableDeclaration).filter(path => {
    if (path.node.declarations.length === 1 && path.node.declarations[0].id.type === 'Identifier') {
      return globals.includes(path.node.declarations[0].id.name);
    }
    return false;
  }).remove();

  // 2. Replace writes: `globalVar = value` -> `appStore.setState({ globalVar: value })`
  root.find(j.AssignmentExpression).filter(path => {
    return path.node.left.type === 'Identifier' && globals.includes(path.node.left.name);
  }).replaceWith(path => {
    return j.callExpression(
      j.memberExpression(j.identifier('appStore'), j.identifier('setState')),
      [j.objectExpression([
        j.property('init', j.identifier(path.node.left.name), path.node.right)
      ])]
    );
  });

  // 3. Replace object property mutations: `dataMeta.mode = "..."` -> `appStore.setState({ dataMeta: { ...appStore.getState().dataMeta, mode: "..." } })`
  root.find(j.AssignmentExpression).filter(path => {
    return path.node.left.type === 'MemberExpression' &&
           path.node.left.object.type === 'Identifier' &&
           globals.includes(path.node.left.object.name);
  }).replaceWith(path => {
    const globalName = path.node.left.object.name;
    const propName = path.node.left.property.name || path.node.left.property.value;
    
    // Instead of doing a complex AST transform for nested sets, we will just transform the read 
    // and rely on a helper or just do `appStore.getState().globalName.propName = value;`
    // Actually, since these objects are mutated deeply, let's just let it be `appStore.getState().globalName.propName = value;`
    return j.assignmentExpression(
      path.node.operator,
      j.memberExpression(
        j.memberExpression(
          j.callExpression(j.memberExpression(j.identifier('appStore'), j.identifier('getState')), []),
          j.identifier(globalName)
        ),
        path.node.left.property
      ),
      path.node.right
    );
  });

  // 4. Replace reads: `globalVar` -> `appStore.getState().globalVar`
  root.find(j.Identifier).filter(path => {
    if (!globals.includes(path.node.name)) return false;
    
    // Ignore if it's already part of appStore.getState().globalVar
    if (path.parent.node.type === 'MemberExpression' && path.parent.node.property === path.node) return false;
    
    // Ignore if it's an object property key: { energyData: ... }
    if (path.parent.node.type === 'Property' && path.parent.node.key === path.node) return false;
    
    // Ignore if it's a parameter or variable declaration
    if (path.parent.node.type === 'FunctionDeclaration' || path.parent.node.type === 'FunctionExpression' || path.parent.node.type === 'ArrowFunctionExpression') {
       if (path.parent.node.params.includes(path.node)) return false;
    }
    if (path.parent.node.type === 'VariableDeclarator' && path.parent.node.id === path.node) return false;
    
    return true;
  }).replaceWith(path => {
    return j.memberExpression(
      j.callExpression(j.memberExpression(j.identifier('appStore'), j.identifier('getState')), []),
      j.identifier(path.node.name)
    );
  });

  return root.toSource();
};
