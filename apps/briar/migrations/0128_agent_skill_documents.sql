alter table briar_agent_skills rename column instructions to body;

alter table briar_agent_skills
  add column description text not null default ''
  check (length(description) <= 1000);

-- Split the standard frontmatter shape accepted by earlier Briar builds. The
-- generated shape placed description last, so folded/literal descriptions can
-- be recovered from the rest of the metadata block without a YAML extension.
with documents as (
  select id, replace(body, char(13), '') as document
  from briar_agent_skills
), frontmatter as (
  select id, document,
         instr(substr(document, 5), char(10) || '---' || char(10))
           as closing_offset
  from documents
  where substr(document, 1, 4) = '---' || char(10)
), descriptions as (
  select id, document, closing_offset,
         ltrim(substr(
           substr(document, 5, closing_offset - 1),
           instr(
             char(10) || substr(document, 5, closing_offset - 1),
             char(10) || 'description:'
           ) + length(char(10) || 'description:') - 1
         )) as description_tail
  from frontmatter
  where closing_offset > 0
    and instr(
      char(10) || substr(document, 5, closing_offset - 1),
      char(10) || 'description:'
    ) > 0
)
update briar_agent_skills
set description = substr(
  case
    when substr(description_tail, 1, instr(description_tail, char(10)) - 1)
         in ('>', '>-', '|', '|-')
      then replace(
        replace(
          trim(substr(description_tail, instr(description_tail, char(10)) + 1)),
          char(10) || '  ',
          ' '
        ),
        char(10),
        ' '
      )
    when instr(description_tail, char(10)) > 0
      then trim(
        substr(description_tail, 1, instr(description_tail, char(10)) - 1),
        ' "' || char(39)
      )
    else trim(description_tail, ' "' || char(39))
  end,
  1,
  1000
)
from descriptions
where briar_agent_skills.id = descriptions.id;

with documents as (
  select id, replace(body, char(13), '') as document
  from briar_agent_skills
), frontmatter as (
  select id, document,
         instr(substr(document, 5), char(10) || '---' || char(10))
           as closing_offset
  from documents
  where substr(document, 1, 4) = '---' || char(10)
)
update briar_agent_skills
set body = trim(
  substr(document, closing_offset + 9),
  char(9) || char(10) || char(13) || ' '
)
from frontmatter
where briar_agent_skills.id = frontmatter.id and closing_offset > 0;

-- Existing plain-text Skills had no separate discovery metadata. Seed their
-- description from the first paragraph while preserving the complete body.
update briar_agent_skills
set description = substr(
  case
    when instr(trim(body), char(10) || char(10)) > 0
      then substr(
        trim(body),
        1,
        instr(trim(body), char(10) || char(10)) - 1
      )
    when length(trim(body)) > 0 then trim(body)
    else name
  end,
  1,
  1000
)
where length(trim(description)) = 0;
