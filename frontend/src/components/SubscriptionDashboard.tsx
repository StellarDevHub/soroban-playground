// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  SubscriptionPlan, 
  UserSubscription, 
  SubscriptionStats 
} from '@/types/subscription';
import { subscriptionService } from '@/services/subscriptionService';
import { useWebSocket } from '@/hooks/useWebSocket';
import { formatCurrency, formatDate, formatDuration } from '@/utils/format';
import { 
  CreditCard, 
  Calendar, 
  TrendingUp, 
  Users, 
  AlertCircle,
  CheckCircle,
  XCircle,
  RefreshCw,
  Settings
} from 'lucide-react';

interface SubscriptionDashboardProps {
  userId: string;
  isAdmin?: boolean;
}

export const SubscriptionDashboard: React.FC<SubscriptionDashboardProps> = ({
  userId,
  isAdmin = false,
}) => {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [subscriptions, setSubscriptions] = useState<UserSubscription[]>([]);
  const [stats, setStats] = useState<SubscriptionStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // WebSocket for real-time updates
  const { lastMessage, sendMessage } = useWebSocket('/ws/subscription');

  // Fetch initial data
  useEffect(() => {
    fetchData();
  }, [userId]);

  // Handle WebSocket messages
  useEffect(() => {
    if (lastMessage) {
      const data = JSON.parse(lastMessage.data);
      handleRealtimeUpdate(data);
    }
  }, [lastMessage]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [plansData, subscriptionsData, statsData] = await Promise.all([
        subscriptionService.getPlans({ active: true }),
        subscriptionService.getUserSubscriptions(userId),
        isAdmin ? subscriptionService.getStats() : Promise.resolve(null),
      ]);

      setPlans(plansData.data);
      setSubscriptions(subscriptionsData.data);
      setStats(statsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  const handleRealtimeUpdate = (data: any) => {
    switch (data.type) {
      case 'PLAN_CREATED':
      case 'PLAN_UPDATED':
        setPlans(prev => {
          const updated = prev.map(plan => 
            plan.planId === data.plan.planId ? data.plan : plan
          );
          if (data.type === 'PLAN_CREATED' && !prev.find(p => p.planId === data.plan.planId)) {
            return [...updated, data.plan];
          }
          return updated;
        });
        break;

      case 'SUBSCRIPTION_CREATED':
      case 'SUBSCRIPTION_UPDATED':
      case 'SUBSCRIPTION_CANCELLED':
        setSubscriptions(prev => {
          const updated = prev.map(sub => 
            sub.subscriptionId === data.subscription.subscriptionId ? data.subscription : sub
          );
          if (data.type === 'SUBSCRIPTION_CREATED' && !prev.find(s => s.subscriptionId === data.subscription.subscriptionId)) {
            return [...updated, data.subscription];
          }
          if (data.type === 'SUBSCRIPTION_CANCELLED') {
            return prev.filter(sub => sub.subscriptionId !== data.subscription.subscriptionId);
          }
          return updated;
        });
        break;

      case 'STATS_UPDATED':
        if (isAdmin) {
          setStats(data.stats);
        }
        break;
    }
  };

  const handleSubscribe = async (planId: string) => {
    try {
      await subscriptionService.createSubscription({
        planId,
        paymentMethod: 'default', // In real app, this would be selected by user
      });
      
      // Refresh data
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create subscription');
    }
  };

  const handleCancelSubscription = async (subscriptionId: string) => {
    try {
      await subscriptionService.cancelSubscription(subscriptionId);
      
      // Refresh data
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel subscription');
    }
  };

  const handleToggleAutoRenew = async (subscriptionId: string, autoRenew: boolean) => {
    try {
      await subscriptionService.toggleAutoRenew(subscriptionId, autoRenew);
      
      // Refresh data
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update auto-renew');
    }
  };

  const getSubscriptionStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge variant="default" className="bg-green-100 text-green-800">Active</Badge>;
      case 'cancelled':
        return <Badge variant="destructive">Cancelled</Badge>;
      case 'expired':
        return <Badge variant="secondary">Expired</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getDaysUntilExpiry = (endDate: string) => {
    const end = new Date(endDate);
    const now = new Date();
    const diffTime = end.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-6 w-6 animate-spin" />
        <span className="ml-2">Loading subscription data...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Admin Stats */}
      {isAdmin && stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Subscriptions</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalSubscriptions}</div>
              <p className="text-xs text-muted-foreground">
                +{stats.monthlyGrowth * 100}% from last month
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Subscriptions</CardTitle>
              <CheckCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.activeSubscriptions}</div>
              <p className="text-xs text-muted-foreground">
                {((stats.activeSubscriptions / stats.totalSubscriptions) * 100).toFixed(1)}% of total
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(stats.totalRevenue)}</div>
              <p className="text-xs text-muted-foreground">
                {formatCurrency(stats.averageRevenuePerSubscription)} avg per subscription
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Churn Rate</CardTitle>
              <XCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{(stats.churnRate * 100).toFixed(1)}%</div>
              <p className="text-xs text-muted-foreground">
                Last 30 days
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs defaultValue="subscriptions" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="subscriptions">My Subscriptions</TabsTrigger>
          <TabsTrigger value="plans">Available Plans</TabsTrigger>
        </TabsList>

        <TabsContent value="subscriptions" className="space-y-4">
          {subscriptions.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center h-64">
                <CreditCard className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Active Subscriptions</h3>
                <p className="text-muted-foreground text-center mb-4">
                  You don't have any active subscriptions. Browse available plans to get started.
                </p>
                <Button onClick={() => document.querySelector('[value="plans"]')?.click()}>
                  Browse Plans
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {subscriptions.map((subscription) => {
                const plan = plans.find(p => p.planId === subscription.planId);
                const daysUntilExpiry = getDaysUntilExpiry(subscription.currentPeriodEnd);
                
                return (
                  <Card key={subscription.subscriptionId}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-lg">{plan?.name || 'Unknown Plan'}</CardTitle>
                          <CardDescription>
                            {formatCurrency(plan?.pricePerPeriod || 0)} / {formatDuration(plan?.billingPeriod || 0)}
                          </CardDescription>
                        </div>
                        <div className="text-right">
                          {getSubscriptionStatusBadge(subscription.status)}
                          <p className="text-sm text-muted-foreground mt-1">
                            ID: {subscription.subscriptionId}
                          </p>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="text-muted-foreground">Current Period</p>
                          <p className="font-medium">
                            {formatDate(subscription.currentPeriodStart)} - {formatDate(subscription.currentPeriodEnd)}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Days Remaining</p>
                          <p className="font-medium">{daysUntilExpiry} days</p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className="text-sm text-muted-foreground">Auto-renew:</span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleToggleAutoRenew(subscription.subscriptionId, !subscription.autoRenew)}
                          >
                            {subscription.autoRenew ? 'Enabled' : 'Disabled'}
                          </Button>
                        </div>

                        {subscription.status === 'active' && (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleCancelSubscription(subscription.subscriptionId)}
                          >
                            Cancel
                          </Button>
                        )}
                      </div>

                      {daysUntilExpiry <= 7 && daysUntilExpiry > 0 && (
                        <Alert>
                          <AlertCircle className="h-4 w-4" />
                          <AlertDescription>
                            Your subscription expires in {daysUntilExpiry} days. 
                            {subscription.autoRenew ? ' It will be automatically renewed.' : ' Enable auto-renew to avoid interruption.'}
                          </AlertDescription>
                        </Alert>
                      )}

                      {daysUntilExpiry <= 0 && subscription.status === 'active' && (
                        <Alert variant="destructive">
                          <XCircle className="h-4 w-4" />
                          <AlertDescription>
                            Your subscription has expired. Please renew to continue service.
                          </AlertDescription>
                        </Alert>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="plans" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {plans.map((plan) => {
              const isSubscribed = subscriptions.some(sub => sub.planId === plan.planId);
              
              return (
                <Card key={plan.planId} className={isSubscribed ? 'border-green-200 bg-green-50' : ''}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">{plan.name}</CardTitle>
                      {isSubscribed && <CheckCircle className="h-5 w-5 text-green-600" />}
                    </div>
                    <CardDescription>{plan.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="text-center">
                      <div className="text-3xl font-bold">{formatCurrency(plan.pricePerPeriod)}</div>
                      <p className="text-muted-foreground">per {formatDuration(plan.billingPeriod)}</p>
                    </div>

                    {plan.maxSubscribers && (
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span>Availability</span>
                          <span>{plan.currentSubscribers}/{plan.maxSubscribers}</span>
                        </div>
                        <Progress 
                          value={(plan.currentSubscribers / plan.maxSubscribers) * 100} 
                          className="h-2"
                        />
                      </div>
                    )}

                    <Button 
                      className="w-full" 
                      disabled={isSubscribed || !plan.isActive}
                      onClick={() => !isSubscribed && handleSubscribe(plan.planId)}
                    >
                      {isSubscribed ? 'Subscribed' : plan.isActive ? 'Subscribe' : 'Unavailable'}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Admin Controls
            </CardTitle>
            <CardDescription>Manage subscription system settings</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => fetchData()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh Data
              </Button>
              {/* Additional admin controls can be added here */}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
