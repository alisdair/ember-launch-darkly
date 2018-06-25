/* eslint-env node */
const MODULE_NAME = 'ember-launch-darkly';
const MEMBER_NAME = 'variation';
const SERVICE_PROPERTY_NAME = 'launchDarkly';
const SERVICE_VARIABLE_NAME = 'launchDarkly';
const SERVICE_INJECTION_FUNCTION_NAME = 'launchDarklyService';

const COMPUTED_MODULE_NAME = 'ember-computed';
const NEW_COMPUTED_MODULE_NAME = '@ember/object';
const COMPUTED_DEFAULT_MEMBER_NAME = 'default';
const COMPUTED_MEMBER_NAME = 'computed';

const EMBER_MODULE_NAME = 'ember';
const EMBER_DEFAULT_MEMBER_NAME = 'default';

function _assertName(path, value) {
  return path.node.name === value;
}

module.exports = function launchDarklyVariationHelperPlugin({ Plugin, types: t }) {
  return new Plugin('launch-darkly-variation-helper', {
    visitor: {
      Program: {
        enter(node, parent, scope, file) {
          let variationImport = _findVariationHelperImport(this, t);

          if (variationImport && _isReferenced(variationImport, t)) {
            file.variationHelperReferenced = true;
          }
        },

        exit(node, parent, scope, file) {
          let variationImport = _findVariationHelperImport(this, t);

          if (variationImport) {
            _removeSpecifierOrImport(variationImport, t);

            if (file.variationHelperReferenced) {
              _insertServiceImport(this, t);
            }
          }
        }
      },

      Identifier(/* node, parent, scope, file */) {
        if (this.referencesImport(MODULE_NAME, MEMBER_NAME)) {
          let parentCallExpression = this.findParent(p => t.isCallExpression(p));
          let key = parentCallExpression.get('arguments.0').node.value;
          parentCallExpression.replaceWith(_build(key, t));

          let { parent, type } = _findParent(parentCallExpression, t);

          switch (type) {
            case 'computed-property': {
              let dependentKey = `${SERVICE_PROPERTY_NAME}.${key}`;

              if (_shouldInjectDependentKey(key, parent, t)) {
                parent.node.arguments.unshift(t.literal(dependentKey));
              }

              let fn = parent.get('arguments').find(a => t.isFunctionExpression(a));

              if (fn && !_containsServiceDeclaration(fn, t)) {
                _insertServiceDeclaration(fn, t);
              }

              return;
            }
            case 'function': {
              _insertServiceDeclaration(parent, t);
              return;
            }
          }
        }
      },

      CallExpression(node, parent, scope, file) {
        if (file.variationHelperReferenced) {
          _insertServiceInjection(this, t);
        }
      }
    }
  });
}

module.exports.baseDir = function() { return __dirname };

function _insertServiceDeclaration(path, t) {
  path.get('body').unshiftContainer('body', _buildServiceDeclaration(t));
}

function _findParent(path, t) {
  let parentComputed = path.findParent(p => {
    let isComputed = t.isCallExpression(p) &&
      t.isIdentifier(p.get('callee')) &&
      (_referencesComputedImport(p.get('callee')) || _referencesComputedDeclaration(p.get('callee')));
    let isEmberDotComputed = t.isCallExpression(p) &&
      t.isMemberExpression(p.get('callee')) &&
      p.get('callee.object').referencesImport(EMBER_MODULE_NAME, EMBER_DEFAULT_MEMBER_NAME) &&
      _assertName(p.get('callee.property'), 'computed');

    return isComputed || isEmberDotComputed;
  });

  if (parentComputed) {
    return { parent: parentComputed, type: 'computed-property' }
  }

  let parentObjectMethod = path.findParent(p => t.isFunctionExpression(p));

  if (parentObjectMethod) {
    return { parent: parentObjectMethod, type: 'function' };
  }
}

function _referencesComputedImport(path) {
  return path.referencesImport(COMPUTED_MODULE_NAME, COMPUTED_DEFAULT_MEMBER_NAME) || path.referencesImport(NEW_COMPUTED_MODULE_NAME, COMPUTED_MEMBER_NAME);
}

function _referencesComputedDeclaration(path) {
  var result = Object.keys(path.scope.bindings).map(function(key) {
    if (key === COMPUTED_MEMBER_NAME && key === path.node.name) {
      var binding = path.scope.bindings[key];

      if (binding.referencePaths.indexOf(path) > -1) {
        return true;
      }
    }
  }).filter(Boolean);

  return result.length > 0;
}

function _buildServiceDeclaration(t) {
  let memberExpression = t.memberExpression(t.thisExpression(), t.identifier('get'));
  let callExpression = t.callExpression(memberExpression, [t.literal(SERVICE_PROPERTY_NAME)]);
  let variableDeclarator = t.variableDeclarator(t.identifier(SERVICE_VARIABLE_NAME), callExpression);
  return t.variableDeclaration('const', [variableDeclarator]);
}

function _findVariationHelperImport(path, t) {
  return path.get('body')
    .filter(obj => t.isImportDeclaration(obj))
    .find(obj => _isVariationImport(obj, t));
}

function _importSpecifier(path, t) {
  return path.get('specifiers')
    .find(obj => t.isImportSpecifier(obj) && _assertName(obj.get('imported'), MEMBER_NAME));
}

function _isVariationImport(path, t) {
  if (path.get('source').node.value === MODULE_NAME) {
    let specifier = _importSpecifier(path, t);

    return !!specifier;
  }
}

function _isReferenced(path, t) {
  let specifier = _importSpecifier(path, t);
  let localName = specifier.get('local').node.name;
  return specifier.scope.bindings[localName].references > 0;
}

function _removeSpecifierOrImport(path, t) {
  if (path.get('specifiers').length > 1) {
    _importSpecifier(path, t).dangerouslyRemove();
  } else {
    path.dangerouslyRemove();
  }
}

function _insertServiceImport(path, t) {
  path.unshiftContainer('body', _buildServiceImport(t));
}

function _buildServiceImport(t) {
  var specifier = t.importSpecifier(t.identifier(SERVICE_INJECTION_FUNCTION_NAME), t.identifier('default'));
  return t.importDeclaration([specifier], t.literal('ember-service/inject'));
}

function _insertServiceInjection(path, t) {
  let callee = path.get('callee');

  if (t.isMemberExpression(callee)) {
    let property = callee.get('property');

    if (t.isIdentifier(property) && _assertName(property, 'extend')) {
      let object = path.get('arguments').find(arg => t.isObjectExpression(arg));

      if (object) {
        object.unshiftContainer('properties', _buildServiceInjection(t));
      }
    }
  }
}

function _buildServiceInjection(t) {
  return t.property(SERVICE_PROPERTY_NAME, t.identifier(SERVICE_PROPERTY_NAME), t.callExpression(t.identifier(SERVICE_INJECTION_FUNCTION_NAME), []));
  // return t.objectProperty(t.identifier(SERVICE_PROPERTY_NAME), t.callExpression(t.identifier(SERVICE_INJECTION_FUNCTION_NAME), []));
}


function _containsServiceDeclaration(path, t) {
  let declaration = path.get('body.body')
    .filter(a => t.isVariableDeclaration(a))
    .find(a => {
      return _assertName(a.get('declarations.0.id'), SERVICE_VARIABLE_NAME);
    })

  return !!declaration;
}

function _shouldInjectDependentKey(key, path, t) {
  let found = path.get('arguments').find(a => {
    return t.isLiteral(a) && _containsDependentKey(key, a.node.value);
  });

  return !found;
}

function _containsDependentKey(key, value) {
  const regex = new RegExp(`${SERVICE_PROPERTY_NAME}\.\{(.*)\}`);
  let matches = value.match(regex);

  return (matches && matches[1] && matches[1].split(',').map(s => s.trim()).includes(key)) ||
    value === `${SERVICE_PROPERTY_NAME}.${key}`;
}

function _build(key, t) {
  return t.callExpression(t.memberExpression(t.identifier(SERVICE_VARIABLE_NAME), t.identifier('get')), [t.literal(key)]);
}
