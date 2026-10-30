function upsertBcuPower(store, equipmentName) {
  if (!bcuEquipmentInfo(equipmentName)) return;
  const samples = Array.isArray(store[equipmentName]) ? store[equipmentName] : [];
  const find = (id) => samples.find(sample => sample &&
    (sample.tagID === id || sample.tagID === equipmentName + '.' + id));
  const voltage = find('InternalSumVoltage');
  const current = find('AmpaceCurrentRaw');
  const now = Date.now();
  const inputTime = sample => typeof sample?.timestamp === 'number'
    ? sample.timestamp : Date.parse(sample?.timestamp);
  const valid = sample => sample && typeof sample.value === 'number' && Number.isFinite(sample.value) &&
    !sample.stale && !['bad', 'uncertain'].includes(String(sample.quality || '').toLowerCase()) &&
    Number.isFinite(inputTime(sample)) && inputTime(sample) <= now && now - inputTime(sample) <= 15000;
  const tagID = equipmentName + '.BcuPower';
  const remaining = samples.filter(sample => sample?.tagID !== tagID && sample?.tagID !== 'BcuPower');
  if (valid(voltage) && valid(current)) {
    // Recalculation must not make cached inputs appear newly measured.
    remaining.push({
      tagID,
      value: Number((voltage.value * -current.value).toFixed(9)),
      timestamp: new Date(Math.min(inputTime(voltage), inputTime(current))).toISOString(),
      alarm: 'No',
      supportingTag: 'No'
    });
  }
  store[equipmentName] = remaining.sort((a, b) => a.tagID.localeCompare(b.tagID));
}
