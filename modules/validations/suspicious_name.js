import { fileFetcher } from '../core/file_fetcher';
import { t, localizer } from '../core/localizer';
import { presetManager } from '../presets';
import { validationIssue, validationIssueFix } from '../core/validation';
import { actionChangeTags } from '../actions/change_tags';


export function validationSuspiciousName() {
  const type = 'suspicious_name';
  const keysToTestForGenericValues = [
    'aerialway', 'aeroway', 'amenity', 'building', 'craft', 'highway',
    'leisure', 'railway', 'man_made', 'office', 'shop', 'tourism', 'waterway'
  ];
  let _dataGenerics;
  let _waitingForGenerics = true;

  fileFetcher.get('nsi_generics')
    .then(data => {
      if (_dataGenerics) return _dataGenerics;

      // known list of generic names (e.g. "bar")
      _dataGenerics = data.genericWords.map(pattern => new RegExp(pattern, 'i'));
      return _dataGenerics;
    })
    .catch(() => { /* ignore */ })
    .finally(() => _waitingForGenerics = false);


  function isDiscardedSuggestionName(lowercaseName) {
    if (!_dataGenerics) return false;
    return _dataGenerics.some(regex => regex.test(lowercaseName));
  }

  // test if the name is just the key or tag value (e.g. "park")
  function nameMatchesRawTag(lowercaseName, tags) {
    for (let i = 0; i < keysToTestForGenericValues.length; i++) {
      let key = keysToTestForGenericValues[i];
      let val = tags[key];
      if (val) {
        val = val.toLowerCase();
        if (key === lowercaseName ||
          val === lowercaseName ||
          key.replace(/\_/g, ' ') === lowercaseName ||
          val.replace(/\_/g, ' ') === lowercaseName) {
          return true;
        }
      }
    }
    return false;
  }

  function isGenericName(name, tags) {
    name = name.toLowerCase();
    return nameMatchesRawTag(name, tags) || isDiscardedSuggestionName(name);
  }

  function makeGenericNameIssue(entityId, nameKey, genericName, langCode) {
    return new validationIssue({
      type: type,
      subtype: 'generic_name',
      severity: 'warning',
      message: function(context) {
        let entity = context.hasEntity(this.entityIds[0]);
        if (!entity) return '';
        let preset = presetManager.match(entity, context.graph());
        let langName = langCode && localizer.languageName(langCode);
        return t.html('issues.generic_name.message' + (langName ? '_language' : ''),
          { feature: preset.name(), name: genericName, language: langName }
        );
      },
      reference: showReference,
      entityIds: [entityId],
      hash: `${nameKey}=${genericName}`,
      dynamicFixes: function() {
        return [
          new validationIssueFix({
            icon: 'iD-operation-delete',
            title: t.html('issues.fix.remove_the_name.title'),
            onClick: function(context) {
              let entityId = this.issue.entityIds[0];
              let entity = context.entity(entityId);
              let tags = Object.assign({}, entity.tags);   // shallow copy
              delete tags[nameKey];
              context.perform(
                actionChangeTags(entityId, tags), t('issues.fix.remove_generic_name.annotation')
              );
            }
          })
        ];
      }
    });

    function showReference(selection) {
      selection.selectAll('.issue-reference')
        .data([0])
        .enter()
        .append('div')
        .attr('class', 'issue-reference')
        .html(t.html('issues.generic_name.reference'));
    }
  }

  function makeIncorrectNameIssue(entityId, nameKey, incorrectName, langCode) {
    return new validationIssue({
      type: type,
      subtype: 'not_name',
      severity: 'warning',
      message: function(context) {
        const entity = context.hasEntity(this.entityIds[0]);
        if (!entity) return '';
        const preset = presetManager.match(entity, context.graph());
        const langName = langCode && localizer.languageName(langCode);
        return t.html('issues.incorrect_name.message' + (langName ? '_language' : ''),
          { feature: preset.name(), name: incorrectName, language: langName }
        );
      },
      reference: showReference,
      entityIds: [entityId],
      hash: `${nameKey}=${incorrectName}`,
      dynamicFixes: function() {
        return [
          new validationIssueFix({
            icon: 'iD-operation-delete',
            title: t.html('issues.fix.remove_the_name.title'),
            onClick: function(context) {
              const entityId = this.issue.entityIds[0];
              const entity = context.entity(entityId);
              let tags = Object.assign({}, entity.tags);   // shallow copy
              delete tags[nameKey];
              context.perform(
                actionChangeTags(entityId, tags), t('issues.fix.remove_mistaken_name.annotation')
              );
            }
          })
        ];
      }
    });

    function showReference(selection) {
      selection.selectAll('.issue-reference')
        .data([0])
        .enter()
        .append('div')
        .attr('class', 'issue-reference')
        .html(t.html('issues.generic_name.reference'));
    }
  }


  let validation = function checkGenericName(entity) {
    const tags = entity.tags;

    // a generic name is allowed if it's a known brand or entity
    const hasWikidata = (!!tags.wikidata || !!tags['brand:wikidata'] || !!tags['operator:wikidata']);
    if (hasWikidata) return [];

    let issues = [];
    const notNames = (tags['not:name'] || '').split(';');

    for (let key in tags) {
      const m = key.match(/^name(?:(?::)([a-zA-Z_-]+))?$/);
      if (!m) continue;

      const langCode = m.length >= 2 ? m[1] : null;
      const value = tags[key];
      if (notNames.length) {
        for (let i in notNames) {
          const notName = notNames[i];
          if (notName && value === notName) {
            issues.push(makeIncorrectNameIssue(entity.id, key, value, langCode));
            continue;
          }
        }
      }
      if (isGenericName(value, tags)) {
        issues.provisional = _waitingForGenerics;  // retry later if we don't have the generics yet
        issues.push(makeGenericNameIssue(entity.id, key, value, langCode));
      }
    }

    return issues;
  };


  validation.type = type;

  return validation;
}
