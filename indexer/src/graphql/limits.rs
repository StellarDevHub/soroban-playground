//! Query Complexity & Depth Limiting for the Soroban Indexer GraphQL API
//!
//! # Problem
//! Unbounded nested GraphQL queries can produce exponential resolver fan-out,
//! consuming 100 % CPU and causing denial-of-service.
//!
//! # Solution
//! Two independent guards run before any resolver is invoked:
//!
//! 1. **Depth limiter** ΓÇö implemented as an async-graphql `Extension` that
//!    walks the incoming query's `ExecutableDocument` AST and rejects any
//!    selection set whose nesting depth exceeds [`MAX_QUERY_DEPTH`].
//!
//! 2. **Complexity limiter** ΓÇö async-graphql's built-in
//!    `SchemaBuilder::limit_complexity` is used (see `schema.rs`), but this
//!    module exposes the canonical constants so both guards share a single
//!    source of truth.
//!
//! ## Constants
//!
//! | Constant          | Value | Meaning                                      |
//! |-------------------|-------|----------------------------------------------|
//! | `MAX_QUERY_DEPTH` | 8     | Maximum allowed selection-set nesting levels |
//! | `MAX_COMPLEXITY`  | 100   | Maximum allowed total complexity score       |
//!
//! Adjust the values here to loosen or tighten the limits across the whole
//! service; no other file needs to change.

use async_graphql::{
    extensions::{Extension, ExtensionContext, ExtensionFactory, NextExecute, NextParseQuery},
    parser::types::{ExecutableDocument, Field, Selection, SelectionSet},
    Response, ServerError, Variables,
};
use std::sync::Arc;

// ΓöÇΓöÇ Public constants ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

/// Maximum allowed query nesting depth.
///
/// Queries deeper than this are rejected immediately before any resolver runs.
pub const MAX_QUERY_DEPTH: usize = 8;

/// Maximum allowed query complexity score.
///
/// Each field contributes a cost (defaulting to 1, or the value provided via
/// `#[graphql(complexity = N)]`).  The schema builder calls
/// `.limit_complexity(MAX_COMPLEXITY)` with this constant.
pub const MAX_COMPLEXITY: usize = 100;

// ΓöÇΓöÇ Depth calculation ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

/// Recursively compute the maximum nesting depth of a [`SelectionSet`].
///
/// The depth of an empty selection set is 0.  Each field that itself has a
/// non-empty selection set adds 1 to the depth of its children.
///
/// # Examples
///
/// - `{ events }` ΓåÆ depth 1
/// - `{ project { events } }` ΓåÆ depth 2
/// - `{ project { events { project { id } } } }` ΓåÆ depth 4
pub fn selection_set_depth(set: &SelectionSet) -> usize {
    set.items
        .iter()
        .map(|item| selection_depth(&item.node))
        .max()
        .unwrap_or(0)
}

fn selection_depth(selection: &Selection) -> usize {
    match selection {
        Selection::Field(field) => field_depth(&field.node),
        Selection::InlineFragment(frag) => selection_set_depth(&frag.node.selection_set.node),
        // Named fragment spreads are resolved later; conservatively assign
        // depth 1 to avoid false negatives.
        Selection::FragmentSpread(_) => 1,
    }
}

fn field_depth(field: &Field) -> usize {
    let child_depth = selection_set_depth(&field.selection_set.node);
    if child_depth == 0 {
        // Leaf field ΓÇö depth contribution is 1.
        1
    } else {
        // Object field ΓÇö 1 for this level plus the deepest child.
        1 + child_depth
    }
}

// ΓöÇΓöÇ DepthLimiter extension factory ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

/// An [`ExtensionFactory`] that produces [`DepthLimiterExtension`] instances.
///
/// Register it on the schema builder:
///
/// ```ignore
/// Schema::build(query, mutation, subscription)
///     .extension(DepthLimiter)
///     // ΓÇª
/// ```
pub struct DepthLimiter;

impl ExtensionFactory for DepthLimiter {
    fn create(&self) -> Arc<dyn Extension> {
        Arc::new(DepthLimiterExtension)
    }
}

// ΓöÇΓöÇ DepthLimiter extension ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

struct DepthLimiterExtension;

#[async_trait::async_trait]
impl Extension for DepthLimiterExtension {
    /// Intercept the parsed query and measure its depth before execution.
    async fn parse_query(
        &self,
        ctx: &ExtensionContext<'_>,
        query: &str,
        variables: &Variables,
        next: NextParseQuery<'_>,
    ) -> async_graphql::ServerResult<ExecutableDocument> {
        // Let the standard parser run first so we get a proper AST.
        let doc = next.run(ctx, query, variables).await?;

        // Walk every top-level operation and every named fragment.
        let max_depth = doc
            .operations
            .iter()
            .map(|(_, op)| selection_set_depth(&op.node.selection_set.node))
            .chain(
                doc.fragments
                    .iter()
                    .map(|(_, frag)| selection_set_depth(&frag.node.selection_set.node)),
            )
            .max()
            .unwrap_or(0);

        if max_depth > MAX_QUERY_DEPTH {
            return Err(ServerError::new(
                format!(
                    "Query depth {max_depth} exceeds the maximum allowed depth of \
                     {MAX_QUERY_DEPTH}."
                ),
                None,
            ));
        }

        Ok(doc)
    }

    /// Pass execution through unchanged ΓÇö depth check happens at parse time.
    async fn execute(
        &self,
        ctx: &ExtensionContext<'_>,
        operation_name: Option<&str>,
        next: NextExecute<'_>,
    ) -> Response {
        next.run(ctx, operation_name).await
    }
}

// ΓöÇΓöÇ Tests ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

#[cfg(test)]
mod tests {
    use super::*;
    use async_graphql::parser::parse_query;

    // ΓöÇΓöÇ helpers ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

    fn depth_of(query: &str) -> usize {
        let doc = parse_query(query).expect("invalid GraphQL");
        doc.operations
            .iter()
            .map(|(_, op)| selection_set_depth(&op.node.selection_set.node))
            .max()
            .unwrap_or(0)
    }

    // ΓöÇΓöÇ depth calculation unit tests ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

    #[test]
    fn depth_of_single_scalar_field_is_1() {
        assert_eq!(depth_of("{ id }"), 1);
    }

    #[test]
    fn depth_of_multiple_flat_fields_is_1() {
        assert_eq!(depth_of("{ id name email }"), 1);
    }

    #[test]
    fn depth_of_nested_object_is_2() {
        assert_eq!(depth_of("{ project { id } }"), 2);
    }

    #[test]
    fn depth_of_three_levels() {
        assert_eq!(depth_of("{ project { events { id } } }"), 3);
    }

    #[test]
    fn depth_of_four_levels() {
        let q = "{ project { events { project { id } } } }";
        assert_eq!(depth_of(q), 4);
    }

    #[test]
    fn depth_counts_deepest_branch() {
        // One branch is depth 1, another is depth 3; overall should be 3.
        let q = "{ id project { events { id } } }";
        assert_eq!(depth_of(q), 3);
    }

    #[test]
    fn depth_of_exactly_max_is_accepted() {
        // Build a query that is exactly MAX_QUERY_DEPTH levels deep.
        // e.g. for MAX_QUERY_DEPTH=8: { a { b { c { d { e { f { g { h } } } } } } } }
        let mut q = String::from("{ a");
        for _ in 1..MAX_QUERY_DEPTH {
            q.push_str(" { b");
        }
        for _ in 1..MAX_QUERY_DEPTH {
            q.push_str(" }");
        }
        q.push_str(" }");
        assert_eq!(depth_of(&q), MAX_QUERY_DEPTH);
    }

    #[test]
    fn depth_of_one_over_max() {
        let mut q = String::from("{ a");
        for _ in 0..MAX_QUERY_DEPTH {
            q.push_str(" { b");
        }
        for _ in 0..MAX_QUERY_DEPTH {
            q.push_str(" }");
        }
        q.push_str(" }");
        assert_eq!(depth_of(&q), MAX_QUERY_DEPTH + 1);
    }

    // ΓöÇΓöÇ integration-style tests using the full schema ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

    mod schema_tests {
        use super::super::*;
        use async_graphql::{EmptyMutation, EmptySubscription, Object, Schema, SimpleObject};

        struct TestQuery;

        #[allow(dead_code)]
        #[derive(SimpleObject)]
        struct Child {
            id: String,
        }

        #[allow(dead_code)]
        #[derive(SimpleObject)]
        struct Parent {
            id: String,
            child: Child,
        }

        #[Object]
        impl TestQuery {
            #[graphql(complexity = 5)]
            async fn parent(&self) -> Parent {
                Parent {
                    id: "p1".into(),
                    child: Child { id: "c1".into() },
                }
            }

            #[graphql(complexity = 1)]
            async fn leaf(&self) -> String {
                "leaf".into()
            }
        }

        fn build_test_schema() -> Schema<TestQuery, EmptyMutation, EmptySubscription> {
            Schema::build(TestQuery, EmptyMutation, EmptySubscription)
                .limit_depth(MAX_QUERY_DEPTH)
                .limit_complexity(MAX_COMPLEXITY)
                .extension(DepthLimiter)
                .finish()
        }

        #[tokio::test]
        async fn valid_shallow_query_passes() {
            let schema = build_test_schema();
            let res = schema.execute("{ leaf }").await;
            assert!(
                res.errors.is_empty(),
                "expected no errors: {:?}",
                res.errors
            );
        }

        #[tokio::test]
        async fn query_at_depth_2_passes() {
            let schema = build_test_schema();
            let res = schema.execute("{ parent { id } }").await;
            assert!(
                res.errors.is_empty(),
                "expected no errors: {:?}",
                res.errors
            );
        }

        #[tokio::test]
        async fn query_exceeding_depth_is_rejected() {
            let schema = build_test_schema();
            // Introspection nesting at depth > 8
            let over_depth = r#"{
                __schema {
                    types {
                        fields {
                            type {
                                fields {
                                    type {
                                        fields {
                                            type { name }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }"#;
            let res = schema.execute(over_depth).await;
            assert!(
                !res.errors.is_empty(),
                "expected an error for over-depth query"
            );
        }

        #[tokio::test]
        async fn low_complexity_query_passes() {
            let schema = build_test_schema();
            let res = schema.execute("{ leaf }").await;
            assert!(
                res.errors.is_empty(),
                "expected no errors: {:?}",
                res.errors
            );
        }

        #[tokio::test]
        async fn high_complexity_query_is_rejected() {
            let schema = build_test_schema();
            // 21 * complexity(5) = 105 > MAX_COMPLEXITY(100)
            let fields: String = (0..21)
                .map(|i| format!("p{i}: parent {{ id }}"))
                .collect::<Vec<_>>()
                .join(" ");
            let q = format!("{{ {fields} }}");
            let res = schema.execute(q).await;
            assert!(
                !res.errors.is_empty(),
                "expected an error for over-complexity query"
            );
        }

        #[tokio::test]
        async fn max_complexity_boundary_exact() {
            let schema = build_test_schema();
            // 20 * complexity(5) = 100 = MAX_COMPLEXITY ΓÇö should pass
            let fields: String = (0..20)
                .map(|i| format!("p{i}: parent {{ id }}"))
                .collect::<Vec<_>>()
                .join(" ");
            let q = format!("{{ {fields} }}");
            let res = schema.execute(q).await;
            assert!(
                res.errors.is_empty(),
                "query at exact complexity limit should pass: {:?}",
                res.errors
            );
        }

        #[tokio::test]
        async fn introspection_typename_does_not_panic() {
            let schema = build_test_schema();
            let res = schema.execute("{ __typename }").await;
            let _ = res; // must not panic
        }

        #[tokio::test]
        async fn named_operation_is_evaluated() {
            let schema = build_test_schema();
            let res = schema.execute("query GetLeaf { leaf }").await;
            assert!(
                res.errors.is_empty(),
                "expected no errors: {:?}",
                res.errors
            );
        }
    }
}
