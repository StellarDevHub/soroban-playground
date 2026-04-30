use async_graphql::*;

pub struct UserRole(pub String);

pub struct RoleGuard {
    role: String,
}

impl RoleGuard {
    pub fn new(role: &str) -> Self {
        Self {
            role: role.to_string(),
        }
    }
}

#[async_trait::async_trait]
impl Guard for RoleGuard {
    async fn check(&self, ctx: &Context<'_>) -> Result<()> {
        if let Some(user_role) = ctx.data_opt::<UserRole>() {
            if user_role.0 == self.role {
                return Ok(());
            }
        }
        Err(Error::new("Forbidden: requires role"))
    }
}
