export async function up(knex) {
  if (!(await knex.schema.hasTable('yjs_documents'))) {
    await knex.schema.createTable('yjs_documents', (table) => {
      table.string('project_id', 256).notNullable();
      table.string('document_id', 256).notNullable();
      table.text('snapshot').notNullable().defaultTo('');
      table.text('state_vector').notNullable().defaultTo('');
      table.timestamp('updated_at').defaultTo(knex.fn.now());
      table.primary(['project_id', 'document_id']);
    });
  }

  if (!(await knex.schema.hasTable('yjs_document_updates'))) {
    await knex.schema.createTable('yjs_document_updates', (table) => {
      table.increments('id').primary();
      table.string('project_id', 256).notNullable();
      table.string('document_id', 256).notNullable();
      table.text('update_data').notNullable();
      table.text('state_vector').notNullable().defaultTo('');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.index(['project_id', 'document_id', 'id'], 'idx_yjs_document_updates_room');
    });
  }

  if (!(await knex.schema.hasTable('workspace_files'))) {
    await knex.schema.createTable('workspace_files', (table) => {
      table.increments('id').primary();
      table.text('project_id').notNullable();
      table.text('path').notNullable();
      table.string('language', 64).notNullable().defaultTo('rust');
      table.text('content').notNullable().defaultTo('');
      table.timestamp('updated_at').defaultTo(knex.fn.now());
      table.unique(['project_id', 'path']);
      table.index(['project_id', 'path'], 'idx_workspace_files_project');
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('workspace_files');
  await knex.schema.dropTableIfExists('yjs_document_updates');
  await knex.schema.dropTableIfExists('yjs_documents');
}
