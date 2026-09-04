{% test dq_required(model, column_name) %}
select * from {{ model }} where {{ adapter.quote(column_name) }} is null or trim(cast({{ adapter.quote(column_name) }} as varchar)) = ''
{% endtest %}

{% test dq_unique(model, column_name) %}
with duplicates as (
  select {{ adapter.quote(column_name) }} as value
  from {{ model }} where {{ adapter.quote(column_name) }} is not null
  group by 1 having count(*) > 1
)
select m.* from {{ model }} m join duplicates d on m.{{ adapter.quote(column_name) }} = d.value
{% endtest %}

{% test dq_pattern(model, column_name, pattern) %}
select * from {{ model }} where nullif(trim(cast({{ adapter.quote(column_name) }} as varchar)), '') is not null
and not regexp_matches(cast({{ adapter.quote(column_name) }} as varchar), '{{ pattern | replace("'", "''") }}')
{% endtest %}

{% test dq_range(model, column_name, min_value=none, max_value=none) %}
select * from {{ model }} where nullif(trim(cast({{ adapter.quote(column_name) }} as varchar)), '') is not null and (
  try_cast({{ adapter.quote(column_name) }} as double) is null
  {% if min_value is not none %} or try_cast({{ adapter.quote(column_name) }} as double) < {{ min_value }} {% endif %}
  {% if max_value is not none %} or try_cast({{ adapter.quote(column_name) }} as double) > {{ max_value }} {% endif %}
)
{% endtest %}

{% test dq_allowed_values(model, column_name, values) %}
select * from {{ model }} where nullif(trim(cast({{ adapter.quote(column_name) }} as varchar)), '') is not null
and {{ adapter.quote(column_name) }} not in (
  {% for value in values %}'{{ value | string | replace("'", "''") }}'{% if not loop.last %}, {% endif %}{% endfor %}
)
{% endtest %}

{% test dq_type(model, column_name, data_type) %}
select * from {{ model }} where nullif(trim(cast({{ adapter.quote(column_name) }} as varchar)), '') is not null and
{% if data_type == 'integer' %} try_cast({{ adapter.quote(column_name) }} as bigint) is null
{% elif data_type == 'number' %} try_cast({{ adapter.quote(column_name) }} as double) is null
{% elif data_type == 'date' %} try_cast({{ adapter.quote(column_name) }} as date) is null
{% else %} false {% endif %}
{% endtest %}
