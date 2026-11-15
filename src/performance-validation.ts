import { boolean, choice, date, fail, id, list, number, object, records, text, timestamp } from './validation'
import { calculateTestValue, calculations, detailLabels, evidenceCategories, measurementMethods, metricGroups, observationSources, qualities, reflectionLabels, shotOutcomes, shotTypes, testCategories, testUnits, type MatchRecord, type TestResult } from './performance-domain'
import { feet, pressures } from './skills-domain'
import { dateKey } from './domain'

function reference(value: unknown, path: string) {
  text(value, path, 2000)
  if (value) {
    try { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol)) fail(path, 'use an HTTP or HTTPS supporting reference.') }
    catch { fail(path, 'use a complete HTTP or HTTPS supporting reference, or leave blank.') }
  }
}
export function validateEvidence(value: unknown, path = 'Evidence') {
  const e = object(value, path, ['category', 'operationalDefinition', 'reference', 'limitations'])
  choice(e.category, `${path}.category`, evidenceCategories); text(e.operationalDefinition, `${path}.operationalDefinition`, 2000, true)
  reference(e.reference, `${path}.reference`); text(e.limitations, `${path}.limitations`, 2000)
  if (String(e.category).startsWith('Research-supported') && !e.reference) fail(path, 'a research-supported classification needs a supporting reference. Otherwise choose coaching-defined or exploratory.')
}
export function validateTestDefinition(value: unknown, path = 'Test definition') {
  const d = object(value, path, ['id', 'name', 'sport', 'category', 'unit', 'direction', 'calculation', 'enabled', 'protocol', 'requiredDetails', 'evidence'])
  id(d.id, `${path}.id`); text(d.name, `${path}.name`, 100, true); text(d.sport, `${path}.sport`, 80, true)
  choice(d.category, `${path}.category`, testCategories); choice(d.unit, `${path}.unit`, testUnits); choice(d.direction, `${path}.direction`, ['Higher', 'Lower'])
  choice(d.calculation, `${path}.calculation`, calculations); boolean(d.enabled, `${path}.enabled`); text(d.protocol, `${path}.protocol`, 3000, true)
  const required = list(d.requiredDetails, `${path}.requiredDetails`, 10)
  for (const field of required) choice(field, `${path}.requiredDetails`, Object.keys(detailLabels))
  if (new Set(required).size !== required.length) fail(path, 'duplicate required protocol fields.')
  validateEvidence(d.evidence, `${path}.evidence`)
  if ((d.calculation === 'Accuracy') !== (d.unit === '%')) fail(path, 'accuracy tests must use %, and % requires the accuracy calculation.')
  if (d.calculation === 'Accuracy' && d.direction !== 'Higher') fail(path, 'accuracy uses higher is better.')
  if (d.unit === 'reps' && d.calculation === 'Mean') fail(path, 'use best or manual for whole repetition counts.')
}
function context(value: unknown, path: string) {
  const c = object(value, path, ['programmeId', 'programmeName', 'sessionId', 'sessionTitle', 'goalId', 'goalTitle'])
  for (const [key, title] of [['programmeId', 'programmeName'], ['sessionId', 'sessionTitle'], ['goalId', 'goalTitle']]) {
    if (c[key] !== null) id(c[key], `${path}.${key}`)
    text(c[title], `${path}.${title}`, title === 'goalTitle' ? 200 : 100, c[key] !== null)
    if (c[key] === null && c[title] !== '') fail(path, 'a context title needs its original identifier.')
  }
}
export function validateTestResult(value: unknown, path = 'Test result') {
  const r = object(value, path, ['id', 'testId', 'date', 'definition', 'protocol', 'quality', 'attempts', 'attemptCount', 'value', 'successes', 'notes', 'context', 'savedAt'])
  id(r.id, `${path}.id`); id(r.testId, `${path}.testId`); date(r.date, `${path}.date`); timestamp(r.savedAt, `${path}.savedAt`)
  validateTestDefinition(r.definition, `${path}.definition`)
  const typed = r as unknown as TestResult
  if (r.testId !== typed.definition.id) fail(path, 'test identifier does not match the saved definition.')
  const p = object(r.protocol, `${path}.protocol`, ['method', 'equipment', 'description', 'details'])
  choice(p.method, `${path}.measurement method`, measurementMethods); text(p.equipment, `${path}.equipment`, 300, true); text(p.description, `${path}.protocol.description`, 3000, true)
  const details = object(p.details, `${path}.protocol.details`, Object.keys(detailLabels))
  for (const key of Object.keys(detailLabels)) text(details[key], `${path}.${detailLabels[key as keyof typeof detailLabels]}`, 300, typed.definition.requiredDetails.includes(key as keyof typeof detailLabels))
  if (details.foot) choice(details.foot, `${path}.foot`, feet)
  if (details.pressure) choice(details.pressure, `${path}.pressure`, pressures)
  for (const key of ['foot', 'pressure']) if (typed.definition.requiredDetails.includes(key as 'foot' | 'pressure') && details[key] === 'Unspecified') fail(path, `record the actual ${key} for a standardised test.`)
  if (details.runIn) number(Number(details.runIn), `${path}.flying run-in metres`, .01, 500, false)
  choice(r.quality, `${path}.quality`, qualities)
  number(r.attemptCount, `${path}.attemptCount`, 1, 10000)
  const attempts = list(r.attempts, `${path}.attempts`, 200)
  attempts.forEach((v, i) => number(v, `${path}.attempts[${i + 1}]`, 0, 1000000, typed.definition.unit === 'reps'))
  number(r.value, `${path}.value`, 0, typed.definition.unit === '%' ? 100 : 1000000, typed.definition.unit === 'reps')
  if (['s', 'cm', 'm', 'km/h'].includes(typed.definition.unit) && (r.value <= 0 || attempts.some(v => (v as number) <= 0))) fail(path, 'time, distance, height and speed measurements must be above zero.')
  if (typed.definition.calculation === 'Accuracy') {
    number(r.successes, `${path}.successes`, 0, r.attemptCount)
    if (attempts.length) fail(path, 'accuracy uses successful attempts and total attempts, not a second result list.')
  } else {
    if (r.successes !== null) fail(path, 'successful attempts belong to accuracy tests only.')
    if (typed.definition.calculation !== 'Manual' && (!attempts.length || attempts.length !== r.attemptCount)) fail(path, 'record each attempt; the count must match the individual results.')
    if (typed.definition.calculation === 'Manual' && attempts.length && attempts.length !== r.attemptCount) fail(path, 'individual attempts must match the attempt count.')
  }
  const expected = calculateTestValue(typed.definition, typed.attempts, typed.attemptCount, typed.successes, typed.value)
  if (!Number.isFinite(expected) || Math.abs(expected - r.value) > 1e-8) fail(path, 'representative result does not match the recorded calculation and attempts.')
  text(r.notes, `${path}.notes`, 4000); context(r.context, `${path}.context`)
}
export function validateMetricDefinition(value: unknown, path = 'Match metric') {
  const m = object(value, path, ['id', 'name', 'group', 'enabled', 'evidence'])
  id(m.id, `${path}.id`); text(m.name, `${path}.name`, 100, true); choice(m.group, `${path}.group`, metricGroups); boolean(m.enabled, `${path}.enabled`); validateEvidence(m.evidence, `${path}.evidence`)
}
export function validateScoringRules(value: unknown, path = 'Scoring rules') {
  const rules = object(value, path, ['name', 'one', 'two', 'goal', 'reference'])
  text(rules.name, `${path}.name`, 100, true); for (const type of shotTypes) number(rules[type], `${path}.${type}`, 1, 20)
  reference(rules.reference, `${path}.reference`)
}
export function validateMatch(value: unknown, path = 'Match') {
  const m = object(value, path, ['id', 'date', 'opponent', 'competition', 'team', 'position', 'minutes', 'result', 'finalScore', 'conditions', 'tacticalNotes', 'source', 'sourceDetails', 'quality', 'rules', 'scoringMode', 'shotCoverage', 'aggregate', 'shots', 'metrics', 'reflections', 'context', 'savedAt'],['fixtureId','rpe','participation'])
  if(m.fixtureId!==undefined)id(m.fixtureId,`${path}.fixtureId`)
  if(m.rpe!==undefined)number(m.rpe,`${path}.rpe`,m.participation==='Did not play'?0:1,10)
  if(m.participation!==undefined)choice(m.participation,`${path}.participation`,['Played','Did not play'])
  if(m.participation==='Did not play'&&(m.minutes!==0||m.rpe!==0))fail(path,'did-not-play records require zero minutes and effort.')
  id(m.id, `${path}.id`); date(m.date, `${path}.date`); timestamp(m.savedAt, `${path}.savedAt`)
  text(m.opponent, `${path}.opponent`, 100, true)
  for (const key of ['competition', 'team', 'position', 'finalScore']) text(m[key], `${path}.${key}`, 100)
  if (m.minutes !== null) number(m.minutes, `${path}.minutes`, 0, 200, false)
  choice(m.result, `${path}.result`, ['Unknown', 'Win', 'Draw', 'Loss']); choice(m.source, `${path}.source`, observationSources); choice(m.quality, `${path}.quality`, ['Recorded', 'Estimated'])
  text(m.sourceDetails, `${path}.sourceDetails`, 1000); text(m.conditions, `${path}.conditions`, 1000); text(m.tacticalNotes, `${path}.tacticalNotes`, 4000)
  if (m.source === 'Other recorded source' && !(m.sourceDetails as string).trim()) fail(path, 'describe the other observation source.')
  validateScoringRules(m.rules, `${path}.rules`)
  choice(m.scoringMode, `${path}.scoringMode`, ['Aggregate', 'Shots']); choice(m.shotCoverage, `${path}.shotCoverage`, ['Complete', 'Partial'])
  const aggregate = object(m.aggregate, `${path}.aggregate`, [...shotTypes])
  for (const type of shotTypes) {
    const pair = object(aggregate[type], `${path}.${type}`, ['attempts', 'successes'])
    if (pair.attempts !== null) number(pair.attempts, `${path}.${type}.attempts`, 0, 10000)
    if (pair.successes !== null) number(pair.successes, `${path}.${type}.successes`, 0, pair.attempts === null ? 10000 : pair.attempts as number)
    if (m.scoringMode === 'Shots' && (pair.attempts !== null || pair.successes !== null)) fail(path, 'shot entry cannot also contain aggregate counts. Choose one source of truth.')
  }
  const shots = records(m.shots, `${path}.shots`, (value, p) => {
    const s = object(value, p, ['id', 'type', 'outcome', 'distance', 'angle', 'foot', 'pressure', 'play'])
    id(s.id, `${p}.id`); choice(s.type, `${p}.type`, shotTypes); choice(s.outcome, `${p}.outcome`, shotOutcomes)
    if (s.distance !== null) number(s.distance, `${p}.distance`, 0, 150, false)
    text(s.angle, `${p}.angle`, 80); choice(s.foot, `${p}.foot`, feet); choice(s.pressure, `${p}.pressure`, pressures); choice(s.play, `${p}.play`, ['Unknown', 'Open play', 'Set play'])
  }, 500)
  if (m.scoringMode === 'Aggregate' && shots.length) fail(path, 'aggregate entry cannot also contain individual shots.')
  const metrics = records(m.metrics, `${path}.metrics`, (value, p) => {
    const row = object(value, p, ['definition', 'value']); validateMetricDefinition(row.definition, `${p}.definition`)
    if (row.value !== null) number(row.value, `${p}.value`, 0, 10000)
  }, 100, 'definition')
  // Definition objects have different identities, so uniqueness is explicitly by their stable IDs.
  const metricIds = metrics.map(r => (r.definition as { id: string }).id)
  if (new Set(metricIds).size !== metricIds.length) fail(path, 'duplicate match metric identifiers.')
  const typed = m as unknown as MatchRecord
  const passed = typed.metrics.find(r => r.definition.id === 'passes')?.value
  const passAttempts = typed.metrics.find(r => r.definition.id === 'pass-attempts')?.value
  if (passed != null && passAttempts != null && passed > passAttempts) fail(path, 'successful passes cannot exceed passing attempts.')
  const reflections = object(m.reflections, `${path}.reflections`, Object.keys(reflectionLabels))
  for (const key of Object.keys(reflectionLabels)) text(reflections[key], `${path}.${key}`, 2000)
  context(m.context, `${path}.context`)
}
export function validatePerformanceData(value: unknown) {
  const p = object(value, 'Performance', ['definitions', 'results', 'matches', 'matchMetrics', 'scoringRules', 'preferences'])
  const definitions = records(p.definitions, 'Test definitions', validateTestDefinition, 200)
  records(p.results, 'Test results', validateTestResult)
  records(p.matches, 'Matches', validateMatch)
  const metrics = records(p.matchMetrics, 'Match metric definitions', validateMetricDefinition, 100)
  validateScoringRules(p.scoringRules)
  const prefs = object(p.preferences, 'Performance preferences', ['focusTestIds', 'focusMetricIds', 'showSkills', 'showTraining'])
  for (const [key, available, max] of [['focusTestIds', definitions, 6], ['focusMetricIds', metrics, 4]] as const) {
    const selected = list(prefs[key], key, max)
    selected.forEach(v => { id(v, key); if (!available.some(d => d.id === v)) fail(key, 'a selected dashboard measure is missing its definition.') })
    if (new Set(selected).size !== selected.length) fail(key, 'duplicate dashboard measures.')
  }
  boolean(prefs.showSkills, 'Show skills'); boolean(prefs.showTraining, 'Show training')
}
export function entryError(validate: (value: unknown) => void, value: unknown): string {
  try {
    validate(value)
    if (value && typeof value === 'object' && 'date' in value && String(value.date) > dateKey()) return 'Choose today or an earlier date for an actual result.'
    return ''
  } catch (error) { return error instanceof Error ? error.message : 'Check the entered details.' }
}
