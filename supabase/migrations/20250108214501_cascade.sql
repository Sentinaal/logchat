alter table measurements
drop constraint measurements_measurement_id_fkey,
add constraint measurements_measurement_id_fkey
  foreign key (measurement_id)
  references logs(id)
  on delete cascade;