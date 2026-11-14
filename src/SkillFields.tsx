import { feet, pressures, skillAreas, type SkillDrill } from './skills-domain'

export function SkillFields({ value, change, objectives = true }: { value: SkillDrill; change: (value: SkillDrill) => void; objectives?: boolean }) {
  const update = (patch: Partial<SkillDrill>) => change({ ...value, ...patch })
  return <div className="stack skill-fields">
    {objectives && <>
      <label>Skill area<select aria-label="Skill area" value={value.area} onChange={e => update({ area: e.target.value as SkillDrill['area'] })}>{skillAreas.map(area => <option key={area}>{area}</option>)}</select></label>
      <label>Practice objective<textarea required maxLength={500} placeholder="What are you practising?" value={value.objective} onChange={e => update({ objective: e.target.value })}/></label>
      <label>Successful attempt means<input required maxLength={500} placeholder="e.g. Ball reaches the target player without bouncing" value={value.successCriteria} onChange={e => update({ successCriteria: e.target.value })}/></label>
    </>}
    <div className="form-grid">
      <label>Foot<select aria-label="Foot" value={value.foot} onChange={e => update({ foot: e.target.value as SkillDrill['foot'] })}>{feet.map(foot => <option key={foot}>{foot}</option>)}</select></label>
      <label>Distance (m, optional)<input type="number" inputMode="decimal" min={0} max={150} step="any" placeholder="Not recorded" value={value.distance ?? ''} onChange={e => update({ distance: e.target.value === '' ? null : Number(e.target.value) })}/></label>
      <label>Angle (optional)<input maxLength={80} placeholder="e.g. 30° left of centre" value={value.angle} onChange={e => update({ angle: e.target.value })}/></label>
      <label>Pressure level<select aria-label="Pressure level" value={value.pressure} onChange={e => update({ pressure: e.target.value as SkillDrill['pressure'] })}>{pressures.map(pressure => <option key={pressure}>{pressure}</option>)}</select></label>
    </div>
  </div>
}
