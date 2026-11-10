// ============================================================================
// src/components/BudgetSystemModal.js
// Centralized Budgeting System (WealthSync Edition) Connected to Map Tracker
// Based on: https://github.com/LuisMalanaDev/CENTRALIZED-BUDGETING-SYSTEM
// ============================================================================

import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Platform
} from 'react-native';

export const EXPENSE_CATEGORIES = [
  { name: 'Food & Dining', emoji: '🍔', color: '#F59E0B' },
  { name: 'Transportation', emoji: '🛵', color: '#3B82F6' },
  { name: 'Hotels & Staycation', emoji: '🏨', color: '#06B6D4' },
  { name: 'Cafés & Boba', emoji: '☕', color: '#A855F7' },
  { name: 'Groceries', emoji: '🛒', color: '#10B981' },
  { name: 'Bills & Utilities', emoji: '🧾', color: '#F43F5E' },
  { name: 'Entertainment', emoji: '🎮', color: '#8B5CF6' },
  { name: 'Other Expense', emoji: '📦', color: '#71717A' }
];

export const INCOME_CATEGORIES = [
  { name: 'Salary / Wages', emoji: '💵' },
  { name: 'Allowance', emoji: '👛' },
  { name: 'Future Earnings', emoji: '📈' },
  { name: 'Side Hustle', emoji: '💼' },
  { name: 'Gifts & Rewards', emoji: '🎁' }
];

export const PAYMENT_METHODS = [
  { id: 'GCASH', label: 'GCash', emoji: '📱', color: '#3B82F6' },
  { id: 'MAYA', label: 'Maya', emoji: '💳', color: '#10B981' },
  { id: 'CASH', label: 'Physical Cash', emoji: '💵', color: '#F59E0B' },
  { id: 'BANK', label: 'Bank', emoji: '🏦', color: '#A855F7' }
];

export default function BudgetSystemModal({
  visible,
  onClose,
  activeTab,
  setActiveTab,
  accounts,
  transactions,
  budgets,
  vaults,
  futureSalary,
  onUpdateFutureSalary,
  onReceiveFutureSalary,
  onUpdateWalletBalance,
  onRecordMapTripExpense,
  onRecordGeneralTransaction,
  onSaveBudgetCap,
  onDeleteBudgetCap,
  onCreateVault,
  onVaultAction,
  onDeleteVault,
  onDeleteTransaction,
  // Map-connected props
  selectedMapPlace,
  nearbyPlaces = [],
  estimateTranspoFare,
  prefillPlaceName,
  setPrefillPlaceName,
  prefillFoodCost,
  setPrefillFoodCost,
  prefillTranspoCost,
  setPrefillTranspoCost
}) {
  // Sub-modals & local state
  const [walletManagerOpen, setWalletManagerOpen] = useState(false);
  const [editingWalletId, setEditingWalletId] = useState(null);
  const [walletBalanceInput, setWalletBalanceInput] = useState('');

  // Quick Log Tab state
  const [logMode, setLogMode] = useState('MAP_TRIP'); // 'MAP_TRIP' | 'EXPENSE' | 'INCOME'
  const [selectedPayment, setSelectedPayment] = useState('CASH');
  const [generalAmount, setGeneralAmount] = useState('');
  const [generalDesc, setGeneralDesc] = useState('');
  const [selectedExpCat, setSelectedExpCat] = useState(EXPENSE_CATEGORIES[0].name);
  const [selectedIncCat, setSelectedIncCat] = useState(INCOME_CATEGORIES[0].name);
  const [futureSalaryInput, setFutureSalaryInput] = useState(String(futureSalary || 5000));

  // Budgets & Vaults sub-tab state
  const [bvSubTab, setBvSubTab] = useState('BUDGETS'); // 'BUDGETS' | 'VAULTS'
  const [budgetCatInput, setBudgetCatInput] = useState(EXPENSE_CATEGORIES[0].name);
  const [budgetLimitInput, setBudgetLimitInput] = useState('');
  const [vaultNameInput, setVaultNameInput] = useState('');
  const [vaultTargetInput, setVaultTargetInput] = useState('');
  const [vaultInitInput, setVaultInitInput] = useState('');
  const [activeVaultForAction, setActiveVaultForAction] = useState(null);
  const [vaultActionType, setVaultActionType] = useState('DEPOSIT');
  const [vaultActionAmt, setVaultActionAmt] = useState('');

  // Ledger filter state
  const [ledgerFilter, setLedgerFilter] = useState('ALL'); // 'ALL' | 'EXPENSE' | 'INCOME'

  // Compute Centralized Metrics (just like OverviewScreen.tsx in CENTRALIZED-BUDGETING-SYSTEM)
  const metrics = useMemo(() => {
    const totalWallets = accounts.reduce((sum, a) => sum + Number(a.balance || 0), 0);
    const totalInflow = transactions
      .filter((t) => t.type === 'INCOME')
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);
    const totalOutflow = transactions
      .filter((t) => t.type === 'EXPENSE')
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);

    // Effective inflow base: if user set wallet balances directly, include them so Money Left is accurate
    const displayInflow = Math.max(totalInflow, totalWallets + totalOutflow);
    const moneyLeft = totalWallets;
    const percentUsed =
      displayInflow > 0 ? Math.min(100, Math.round((totalOutflow / displayInflow) * 100)) : 0;
    const percentRemaining = Math.max(0, 100 - percentUsed);

    // Category Breakdown (Top Money Drains)
    const catMap = {};
    transactions
      .filter((t) => t.type === 'EXPENSE')
      .forEach((t) => {
        const c = t.category || 'Food & Dining';
        catMap[c] = (catMap[c] || 0) + Number(t.amount || 0);
      });

    const breakdown = Object.keys(catMap)
      .map((name) => {
        const amt = catMap[name];
        const found = EXPENSE_CATEGORIES.find((e) => e.name === name);
        return {
          name,
          emoji: found ? found.emoji : '💸',
          color: found ? found.color : '#F59E0B',
          amount: amt,
          percentage: totalOutflow > 0 ? Math.round((amt / totalOutflow) * 100) : 0
        };
      })
      .sort((a, b) => b.amount - a.amount);

    return {
      totalWallets,
      displayInflow,
      totalOutflow,
      netCashflow: displayInflow - totalOutflow,
      moneyLeft,
      percentUsed,
      percentRemaining,
      breakdown
    };
  }, [accounts, transactions]);

  const filteredLedger = useMemo(() => {
    if (ledgerFilter === 'ALL') return transactions;
    return transactions.filter((t) => t.type === ledgerFilter);
  }, [transactions, ledgerFilter]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.container}>
          {/* Top App Header Bar (WealthSync Monochrome Style) */}
          <View style={styles.topHeader}>
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={styles.appTitle}>CENTRALIZED BUDGET</Text>
                <View style={styles.liveBadge}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveText}>Map Linked</Text>
                </View>
              </View>
              <Text style={styles.appSub}>
                Connected to CraveNav Restaurants, Hotels & Route Transpo
              </Text>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Bottom-Style 4-Tab Switcher (Overview | Quick Log | Budgets & Vaults | Ledger) */}
          <View style={styles.mainTabBar}>
            {[
              { id: 'overview', label: 'Overview' },
              { id: 'spend', label: '+ Quick Log' },
              { id: 'budgets', label: 'Budgets & Vaults' },
              { id: 'history', label: `Ledger (${transactions.length})` }
            ].map((tab) => {
              const isAct = activeTab === tab.id;
              return (
                <TouchableOpacity
                  key={tab.id}
                  style={[styles.mainTabBtn, isAct && styles.mainTabBtnActive]}
                  onPress={() => setActiveTab(tab.id)}
                >
                  <Text style={[styles.mainTabText, isAct && styles.mainTabTextActive]}>
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* =============================================================== */}
          {/* TAB 1: OVERVIEW (Exact CENTRALIZED-BUDGETING-SYSTEM Hero + Grid)*/}
          {/* =============================================================== */}
          {activeTab === 'overview' && (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}
            >
              {/* Main Inflow vs Expenses Hero Card (Money Left / Remaining Inflow) */}
              <View style={styles.heroCard}>
                <View style={styles.heroHeader}>
                  <View>
                    <Text style={styles.heroLabel}>MONEY LEFT (CURRENT BALANCE)</Text>
                    <Text style={styles.heroFilterNote}>Active Map & Wallet Cycle</Text>
                  </View>

                  <TouchableOpacity
                    style={styles.walletBadge}
                    onPress={() => setWalletManagerOpen(!walletManagerOpen)}
                  >
                    <Text style={styles.walletBadgeText}>
                      💳 {accounts.length} Wallets ▾
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Big Remaining Money Amount */}
                <Text
                  style={[
                    styles.heroAmount,
                    metrics.moneyLeft < 0 && { color: '#F87171' }
                  ]}
                >
                  ₱
                  {Number(metrics.moneyLeft).toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                  })}
                </Text>

                {/* Expandable Multi-Wallet Drawer (GCash, Maya, Physical Cash, Bank) */}
                {walletManagerOpen && (
                  <View style={styles.walletDrawer}>
                    <Text style={styles.walletDrawerTitle}>
                      TAP ANY WALLET TO SET EXACT CURRENT MONEY:
                    </Text>
                    {accounts.map((acc) => (
                      <View key={acc.id} style={styles.walletItemRow}>
                        <Text style={styles.walletItemName}>
                          {acc.emoji} {acc.name}
                        </Text>
                        {editingWalletId === acc.id ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <TextInput
                              style={styles.walletInlineInput}
                              placeholder="Amount"
                              placeholderTextColor="#71717A"
                              keyboardType="numeric"
                              value={walletBalanceInput}
                              onChangeText={setWalletBalanceInput}
                            />
                            <TouchableOpacity
                              style={styles.walletSaveMiniBtn}
                              onPress={() => {
                                const val = parseFloat(walletBalanceInput);
                                if (!isNaN(val) && val >= 0) {
                                  onUpdateWalletBalance(acc.id, val);
                                }
                                setEditingWalletId(null);
                              }}
                            >
                              <Text style={{ color: '#000', fontSize: 11, fontWeight: '800' }}>
                                Save
                              </Text>
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <TouchableOpacity
                            style={styles.walletBalBtn}
                            onPress={() => {
                              setEditingWalletId(acc.id);
                              setWalletBalanceInput(String(acc.balance));
                            }}
                          >
                            <Text style={styles.walletItemBal}>
                              ₱{Number(acc.balance).toLocaleString('en-US', { minimumFractionDigits: 2 })} ✎
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    ))}
                  </View>
                )}

                {/* Inflow vs Outflow Comparison Box */}
                <View style={styles.inflowComparisonBox}>
                  <View style={styles.inflowCompareRow}>
                    <View style={styles.inflowCompareCol}>
                      <View style={styles.inflowIndicatorDot} />
                      <View>
                        <Text style={styles.inflowCompareLabel}>Total Inflow (Budget)</Text>
                        <Text style={styles.inflowCompareVal}>
                          +₱{metrics.displayInflow.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.inflowDivider} />

                    <View style={styles.inflowCompareCol}>
                      <View style={styles.outflowIndicatorDot} />
                      <View>
                        <Text style={styles.inflowCompareLabel}>Total Spent (Outflow)</Text>
                        <Text style={styles.outflowCompareVal}>
                          −₱{metrics.totalOutflow.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </Text>
                      </View>
                    </View>
                  </View>

                  {/* Progress Bar Comparing Inflow to Expenses */}
                  <View style={styles.inflowProgressSection}>
                    <View style={styles.inflowProgressTrack}>
                      <View
                        style={[
                          styles.inflowProgressBar,
                          {
                            width: `${metrics.percentUsed}%`,
                            backgroundColor:
                              metrics.percentUsed >= 100
                                ? '#EF4444'
                                : metrics.percentUsed >= 80
                                ? '#F59E0B'
                                : '#FFFFFF'
                          }
                        ]}
                      />
                    </View>
                    <View style={styles.inflowProgressLabels}>
                      <Text style={styles.inflowProgressSub}>
                        {metrics.percentUsed}% spent (₱
                        {metrics.totalOutflow.toLocaleString('en-US', { minimumFractionDigits: 2 })})
                      </Text>
                      <Text style={styles.inflowProgressSub}>
                        {metrics.percentRemaining}% left (₱
                        {Math.max(0, metrics.moneyLeft).toLocaleString('en-US', {
                          minimumFractionDigits: 2
                        })}
                        )
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Primary White Action Button (From OverviewScreen.tsx) */}
                <TouchableOpacity
                  style={styles.quickAddHeroBtn}
                  onPress={() => {
                    setLogMode('MAP_TRIP');
                    setActiveTab('spend');
                  }}
                >
                  <Text style={styles.quickAddHeroText}>
                    + Quick Log Map Meal / Transpo / Inflow
                  </Text>
                </TouchableOpacity>
              </View>

              {/* 4 Quick Stat Cards (2x2 Grid from OverviewScreen.tsx) */}
              <View style={styles.statsGrid}>
                <View style={styles.statsRow}>
                  <View style={styles.statCard}>
                    <Text style={styles.statLabel}>Total Inflow</Text>
                    <Text style={[styles.statValue, { color: '#4ADE80' }]}>
                      +₱{metrics.displayInflow.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </Text>
                  </View>
                  <View style={styles.statCard}>
                    <Text style={styles.statLabel}>Total Outflow</Text>
                    <Text style={[styles.statValue, { color: '#F87171' }]}>
                      −₱{metrics.totalOutflow.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </Text>
                  </View>
                </View>
                <View style={styles.statsRow}>
                  <View style={styles.statCard}>
                    <Text style={styles.statLabel}>Net Cashflow</Text>
                    <Text style={styles.statValue}>
                      ₱{metrics.moneyLeft.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </Text>
                  </View>
                  <View style={styles.statCard}>
                    <Text style={styles.statLabel}>Logged Items</Text>
                    <Text style={styles.statValue}>{transactions.length} records</Text>
                  </View>
                </View>
              </View>

              {/* 🏆 Top Money Drains (From OverviewScreen.tsx) */}
              <View style={styles.sectionCard}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>🔥 Top Money Drains</Text>
                  <Text style={styles.sectionBadge}>By Category</Text>
                </View>
                {metrics.breakdown.length === 0 ? (
                  <Text style={styles.emptyText}>
                    Zero outflow recorded yet. Log a restaurant meal or ride to see breakdown!
                  </Text>
                ) : (
                  metrics.breakdown.slice(0, 4).map((item, index) => {
                    const ranks = ['🥇', '🥈', '🥉', '4️⃣'];
                    return (
                      <View key={item.name} style={styles.drainRow}>
                        <View style={styles.drainTopLine}>
                          <Text style={styles.drainName}>
                            {ranks[index]} {item.emoji} {item.name}
                          </Text>
                          <Text style={styles.drainAmt}>
                            ₱{item.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} (
                            {item.percentage}%)
                          </Text>
                        </View>
                        <View style={styles.drainTrack}>
                          <View
                            style={[
                              styles.drainBar,
                              { width: `${item.percentage}%`, backgroundColor: item.color }
                            ]}
                          />
                        </View>
                      </View>
                    );
                  })
                )}
              </View>

              {/* Recent Transactions Preview */}
              <View style={styles.sectionCard}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>Recent Ledger Activity</Text>
                  <TouchableOpacity onPress={() => setActiveTab('history')}>
                    <Text style={styles.sectionLink}>View All ➔</Text>
                  </TouchableOpacity>
                </View>
                {transactions.length === 0 ? (
                  <Text style={styles.emptyText}>No transactions recorded yet.</Text>
                ) : (
                  transactions.slice(0, 4).map((tx) => {
                    const isInc = tx.type === 'INCOME';
                    return (
                      <View key={tx.id} style={styles.txItem}>
                        <View style={styles.txIconBox}>
                          <Text style={{ fontSize: 15 }}>{tx.emoji || (isInc ? '💵' : '🍔')}</Text>
                        </View>
                        <View style={{ flex: 1, marginHorizontal: 10 }}>
                          <Text style={styles.txTitle} numberOfLines={1}>
                            {tx.description || tx.category}
                          </Text>
                          <Text style={styles.txMeta} numberOfLines={1}>
                            {tx.category} • {tx.paymentMethod} • {tx.dateText}
                          </Text>
                        </View>
                        <Text
                          style={[
                            styles.txAmount,
                            isInc ? { color: '#4ADE80' } : { color: '#F87171' }
                          ]}
                        >
                          {isInc ? '+' : '−'}₱{Number(tx.amount).toLocaleString()}
                        </Text>
                      </View>
                    );
                  })
                )}
              </View>
            </ScrollView>
          )}

          {/* =============================================================== */}
          {/* TAB 2: QUICK LOG (Map Restaurant + Route Transpo + Inflow)      */}
          {/* =============================================================== */}
          {activeTab === 'spend' && (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}
            >
              {/* Mode Switcher */}
              <View style={styles.typeSwitcher}>
                {[
                  { id: 'MAP_TRIP', label: '🗺️ Map Meal + Transpo' },
                  { id: 'EXPENSE', label: '💸 Other Expense' },
                  { id: 'INCOME', label: '💰 Add Salary / Inflow' }
                ].map((m) => (
                  <TouchableOpacity
                    key={m.id}
                    style={[styles.typeBtn, logMode === m.id && styles.typeBtnActive]}
                    onPress={() => setLogMode(m.id)}
                  >
                    <Text
                      style={[styles.typeBtnText, logMode === m.id && styles.typeBtnTextActive]}
                    >
                      {m.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Wallet Selector (GCash, Maya, Physical Cash, Bank) */}
              <Text style={styles.fieldLabel}>Select Wallet Account</Text>
              <View style={styles.paymentRow}>
                {PAYMENT_METHODS.map((pm) => {
                  const acc = accounts.find((a) => a.id === pm.id);
                  const isSel = selectedPayment === pm.id;
                  return (
                    <TouchableOpacity
                      key={pm.id}
                      style={[styles.paymentChip, isSel && styles.paymentChipActive]}
                      onPress={() => setSelectedPayment(pm.id)}
                    >
                      <Text
                        style={[styles.paymentChipText, isSel && styles.paymentChipTextActive]}
                      >
                        {pm.emoji} {pm.label} (₱{acc ? Number(acc.balance).toLocaleString() : 0})
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {logMode === 'MAP_TRIP' && (
                <View style={styles.formCard}>
                  <Text style={styles.fieldLabel}>
                    1. Map Restaurant / Hotel (Tap a nearby spot or type below)
                  </Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. Jollibee, Queen Margarette Hotel..."
                    placeholderTextColor="#71717A"
                    value={prefillPlaceName}
                    onChangeText={setPrefillPlaceName}
                  />

                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={{ marginBottom: 12 }}
                  >
                    {nearbyPlaces.slice(0, 10).map((p) => {
                      const fare = estimateTranspoFare ? estimateTranspoFare(p.distanceMeters, 'driving') : 25;
                      return (
                        <TouchableOpacity
                          key={p.id}
                          style={styles.mapSpotChip}
                          onPress={() => {
                            setPrefillPlaceName(`${p.emoji} ${p.name}`);
                            setPrefillTranspoCost(String(fare));
                          }}
                        >
                          <Text style={styles.mapSpotChipText}>
                            {p.emoji} {p.name} (~₱{fare} transpo)
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>

                  <Text style={styles.fieldLabel}>2. Food or Hotel Spend (₱)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. 450"
                    placeholderTextColor="#71717A"
                    keyboardType="numeric"
                    value={prefillFoodCost}
                    onChangeText={setPrefillFoodCost}
                  />
                  <View style={styles.presetRow}>
                    {[100, 200, 300, 450, 500, 1000].map((v) => (
                      <TouchableOpacity
                        key={v}
                        style={styles.presetPill}
                        onPress={() => setPrefillFoodCost(String(v))}
                      >
                        <Text style={styles.presetPillText}>₱{v}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={styles.fieldLabel}>
                    3. Route Transportation Cost (₱) — Auto-linked to Map Distance
                  </Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. 50"
                    placeholderTextColor="#71717A"
                    keyboardType="numeric"
                    value={prefillTranspoCost}
                    onChangeText={setPrefillTranspoCost}
                  />
                  <View style={styles.presetRow}>
                    {[
                      { lbl: '🚶 Walk ₱0', val: 0 },
                      { lbl: '🛵 ₱25', val: 25 },
                      { lbl: '🛵 ₱50', val: 50 },
                      { lbl: '🔄 Roundtrip ₱100', val: 100 }
                    ].map((t) => (
                      <TouchableOpacity
                        key={t.lbl}
                        style={styles.presetPill}
                        onPress={() => setPrefillTranspoCost(String(t.val))}
                      >
                        <Text style={styles.presetPillText}>{t.lbl}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* Live Balance Preview Box */}
                  {(() => {
                    const f = Math.max(0, parseFloat(prefillFoodCost) || 0);
                    const tr = Math.max(0, parseFloat(prefillTranspoCost) || 0);
                    const tot = f + tr;
                    const after = metrics.moneyLeft - tot;
                    return (
                      <View style={styles.previewBox}>
                        <Text style={styles.previewTop}>
                          Current Money: ₱{metrics.moneyLeft.toLocaleString()} − Trip Total: ₱
                          {tot.toLocaleString()} (Food ₱{f} + Transpo ₱{tr})
                        </Text>
                        <Text style={styles.previewBottom}>
                          Remaining Money After Trip: ₱{after.toLocaleString()}
                        </Text>
                      </View>
                    );
                  })()}

                  <TouchableOpacity
                    style={styles.whiteSubmitBtn}
                    onPress={() => {
                      onRecordMapTripExpense(selectedPayment);
                    }}
                  >
                    <Text style={styles.whiteSubmitBtnText}>
                      Record Map Meal & Transpo Expense
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {logMode === 'EXPENSE' && (
                <View style={styles.formCard}>
                  <Text style={styles.fieldLabel}>Expense Category</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={{ marginBottom: 12 }}
                  >
                    {EXPENSE_CATEGORIES.map((c) => {
                      const isSel = selectedExpCat === c.name;
                      return (
                        <TouchableOpacity
                          key={c.name}
                          style={[styles.paymentChip, isSel && styles.paymentChipActive]}
                          onPress={() => setSelectedExpCat(c.name)}
                        >
                          <Text
                            style={[styles.paymentChipText, isSel && styles.paymentChipTextActive]}
                          >
                            {c.emoji} {c.name}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>

                  <Text style={styles.fieldLabel}>Amount (₱)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. 500"
                    placeholderTextColor="#71717A"
                    keyboardType="numeric"
                    value={generalAmount}
                    onChangeText={setGeneralAmount}
                  />

                  <Text style={styles.fieldLabel}>Description / Merchant</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. Dinner with friends / Tricycle"
                    placeholderTextColor="#71717A"
                    value={generalDesc}
                    onChangeText={setGeneralDesc}
                  />

                  <TouchableOpacity
                    style={styles.whiteSubmitBtn}
                    onPress={() => {
                      const amt = parseFloat(generalAmount);
                      if (!isNaN(amt) && amt > 0) {
                        onRecordGeneralTransaction({
                          type: 'EXPENSE',
                          amount: amt,
                          category: selectedExpCat,
                          paymentMethod: selectedPayment,
                          description: generalDesc.trim() || selectedExpCat
                        });
                        setGeneralAmount('');
                        setGeneralDesc('');
                        setActiveTab('overview');
                      }
                    }}
                  >
                    <Text style={styles.whiteSubmitBtnText}>Record Expense</Text>
                  </TouchableOpacity>
                </View>
              )}

              {logMode === 'INCOME' && (
                <View style={styles.formCard}>
                  <Text style={styles.fieldLabel}>Inflow / Income Source</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={{ marginBottom: 12 }}
                  >
                    {INCOME_CATEGORIES.map((c) => {
                      const isSel = selectedIncCat === c.name;
                      return (
                        <TouchableOpacity
                          key={c.name}
                          style={[styles.paymentChip, isSel && styles.paymentChipActive]}
                          onPress={() => setSelectedIncCat(c.name)}
                        >
                          <Text
                            style={[styles.paymentChipText, isSel && styles.paymentChipTextActive]}
                          >
                            {c.emoji} {c.name}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>

                  <Text style={styles.fieldLabel}>
                    Amount Received (₱) — Adds to ₱{metrics.moneyLeft.toLocaleString()}
                  </Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. 5000"
                    placeholderTextColor="#71717A"
                    keyboardType="numeric"
                    value={generalAmount}
                    onChangeText={setGeneralAmount}
                  />
                  <View style={styles.presetRow}>
                    {[500, 1000, 2500, 5000, 10000].map((v) => (
                      <TouchableOpacity
                        key={v}
                        style={styles.presetPill}
                        onPress={() => setGeneralAmount(String(v))}
                      >
                        <Text style={styles.presetPillText}>+₱{v.toLocaleString()}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={styles.fieldLabel}>Notes (e.g. Monthly Salary, Allowance)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. Payroll Salary"
                    placeholderTextColor="#71717A"
                    value={generalDesc}
                    onChangeText={setGeneralDesc}
                  />

                  <TouchableOpacity
                    style={styles.whiteSubmitBtn}
                    onPress={() => {
                      const amt = parseFloat(generalAmount);
                      if (!isNaN(amt) && amt > 0) {
                        onRecordGeneralTransaction({
                          type: 'INCOME',
                          amount: amt,
                          category: selectedIncCat,
                          paymentMethod: selectedPayment,
                          description: generalDesc.trim() || selectedIncCat
                        });
                        setGeneralAmount('');
                        setGeneralDesc('');
                        setActiveTab('overview');
                      }
                    }}
                  >
                    <Text style={styles.whiteSubmitBtnText}>
                      + Add to My Current Money (➔ ₱
                      {(metrics.moneyLeft + (parseFloat(generalAmount) || 0)).toLocaleString()})
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>
          )}

          {/* =============================================================== */}
          {/* TAB 3: BUDGETS & VAULTS (From BudgetsScreen.tsx)                */}
          {/* =============================================================== */}
          {activeTab === 'budgets' && (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}
            >
              <View style={styles.typeSwitcher}>
                <TouchableOpacity
                  style={[styles.typeBtn, bvSubTab === 'BUDGETS' && styles.typeBtnActive]}
                  onPress={() => setBvSubTab('BUDGETS')}
                >
                  <Text
                    style={[
                      styles.typeBtnText,
                      bvSubTab === 'BUDGETS' && styles.typeBtnTextActive
                    ]}
                  >
                    📊 Category Budget Caps
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.typeBtn, bvSubTab === 'VAULTS' && styles.typeBtnActive]}
                  onPress={() => setBvSubTab('VAULTS')}
                >
                  <Text
                    style={[
                      styles.typeBtnText,
                      bvSubTab === 'VAULTS' && styles.typeBtnTextActive
                    ]}
                  >
                    🔒 Savings Lockboxes ({vaults.length})
                  </Text>
                </TouchableOpacity>
              </View>

              {bvSubTab === 'BUDGETS' ? (
                <>
                  {/* Create / Update Category Budget Cap */}
                  <View style={styles.formCard}>
                    <Text style={styles.fieldLabel}>Set Monthly Category Budget Cap</Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      style={{ marginBottom: 10 }}
                    >
                      {EXPENSE_CATEGORIES.map((c) => {
                        const isSel = budgetCatInput === c.name;
                        return (
                          <TouchableOpacity
                            key={c.name}
                            style={[styles.paymentChip, isSel && styles.paymentChipActive]}
                            onPress={() => setBudgetCatInput(c.name)}
                          >
                            <Text
                              style={[
                                styles.paymentChipText,
                                isSel && styles.paymentChipTextActive
                              ]}
                            >
                              {c.emoji} {c.name}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TextInput
                        style={[styles.input, { flex: 1, marginBottom: 0 }]}
                        placeholder="Monthly Limit (e.g. 3000)"
                        placeholderTextColor="#71717A"
                        keyboardType="numeric"
                        value={budgetLimitInput}
                        onChangeText={setBudgetLimitInput}
                      />
                      <TouchableOpacity
                        style={styles.saveFutureBtn}
                        onPress={() => {
                          const lim = parseFloat(budgetLimitInput);
                          if (!isNaN(lim) && lim > 0) {
                            onSaveBudgetCap(budgetCatInput, lim);
                            setBudgetLimitInput('');
                          }
                        }}
                      >
                        <Text style={{ color: '#000', fontWeight: '800', fontSize: 12 }}>
                          + Set Cap
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Active Category Budget Caps List */}
                  {budgets.map((b) => {
                    const spent = transactions
                      .filter((t) => t.type === 'EXPENSE' && t.category === b.category)
                      .reduce((sum, t) => sum + Number(t.amount || 0), 0);
                    const pct = b.limit > 0 ? Math.round((spent / b.limit) * 100) : 0;
                    const isOver = spent > b.limit;
                    return (
                      <View
                        key={b.id}
                        style={[styles.sectionCard, isOver && { borderColor: '#EF4444' }]}
                      >
                        <View style={styles.sectionHeaderRow}>
                          <Text style={styles.sectionTitle}>{b.category}</Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <Text
                              style={{
                                color: isOver ? '#EF4444' : pct >= 80 ? '#F59E0B' : '#FFF',
                                fontWeight: '800',
                                fontSize: 13
                              }}
                            >
                              {pct}%
                            </Text>
                            <TouchableOpacity onPress={() => onDeleteBudgetCap(b.id)}>
                              <Text style={{ color: '#71717A', fontSize: 13 }}>🗑️</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                        <View style={styles.drainTrack}>
                          <View
                            style={[
                              styles.drainBar,
                              {
                                width: `${Math.min(100, pct)}%`,
                                backgroundColor: isOver
                                  ? '#EF4444'
                                  : pct >= 80
                                  ? '#F59E0B'
                                  : '#FFFFFF'
                              }
                            ]}
                          />
                        </View>
                        <View
                          style={{
                            flexDirection: 'row',
                            justifyContent: 'space-between',
                            marginTop: 6
                          }}
                        >
                          <Text style={styles.txMeta}>₱{spent.toLocaleString()} spent</Text>
                          <Text style={styles.txMeta}>
                            {isOver
                              ? `Exceeded by ₱${(spent - b.limit).toLocaleString()}`
                              : `₱${Math.max(0, b.limit - spent).toLocaleString()} left • Cap: ₱${b.limit.toLocaleString()}`}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </>
              ) : (
                <>
                  {/* Savings Vaults / Lockboxes (From BudgetsScreen.tsx) */}
                  <View style={styles.formCard}>
                    <Text style={styles.fieldLabel}>Create Savings Vault / Lockbox</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="Vault Name (e.g. Food Trip Fund, Emergency)"
                      placeholderTextColor="#71717A"
                      value={vaultNameInput}
                      onChangeText={setVaultNameInput}
                    />
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TextInput
                        style={[styles.input, { flex: 1 }]}
                        placeholder="Target Goal (₱)"
                        placeholderTextColor="#71717A"
                        keyboardType="numeric"
                        value={vaultTargetInput}
                        onChangeText={setVaultTargetInput}
                      />
                      <TextInput
                        style={[styles.input, { flex: 1 }]}
                        placeholder="Initial Saved (₱)"
                        placeholderTextColor="#71717A"
                        keyboardType="numeric"
                        value={vaultInitInput}
                        onChangeText={setVaultInitInput}
                      />
                    </View>
                    <TouchableOpacity
                      style={styles.whiteSubmitBtn}
                      onPress={() => {
                        const target = parseFloat(vaultTargetInput);
                        const init = parseFloat(vaultInitInput) || 0;
                        if (vaultNameInput.trim() && !isNaN(target) && target > 0) {
                          onCreateVault(vaultNameInput.trim(), target, init);
                          setVaultNameInput('');
                          setVaultTargetInput('');
                          setVaultInitInput('');
                        }
                      }}
                    >
                      <Text style={styles.whiteSubmitBtnText}>+ Create Savings Vault</Text>
                    </TouchableOpacity>
                  </View>

                  {vaults.map((v) => {
                    const pct =
                      v.targetAmount > 0
                        ? Math.min(100, Math.round((v.currentAmount / v.targetAmount) * 100))
                        : 0;
                    return (
                      <View key={v.id} style={styles.sectionCard}>
                        <View style={styles.sectionHeaderRow}>
                          <Text style={styles.sectionTitle}>🔒 {v.name}</Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <Text style={{ color: '#10B981', fontWeight: '800' }}>{pct}%</Text>
                            <TouchableOpacity onPress={() => onDeleteVault(v.id)}>
                              <Text style={{ color: '#71717A', fontSize: 13 }}>🗑️</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                        <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '800', marginBottom: 6 }}>
                          ₱{Number(v.currentAmount).toLocaleString()}{' '}
                          <Text style={{ color: '#71717A', fontSize: 12, fontWeight: '500' }}>
                            of ₱{Number(v.targetAmount).toLocaleString()} goal
                          </Text>
                        </Text>
                        <View style={styles.drainTrack}>
                          <View
                            style={[
                              styles.drainBar,
                              { width: `${pct}%`, backgroundColor: '#10B981' }
                            ]}
                          />
                        </View>

                        {activeVaultForAction === v.id ? (
                          <View style={{ flexDirection: 'row', gap: 6, marginTop: 10 }}>
                            <TextInput
                              style={[styles.input, { flex: 1, marginBottom: 0, height: 36 }]}
                              placeholder="Amount (₱)"
                              placeholderTextColor="#71717A"
                              keyboardType="numeric"
                              value={vaultActionAmt}
                              onChangeText={setVaultActionAmt}
                            />
                            <TouchableOpacity
                              style={styles.saveFutureBtn}
                              onPress={() => {
                                const val = parseFloat(vaultActionAmt);
                                if (!isNaN(val) && val > 0) {
                                  onVaultAction(v.id, vaultActionType, val);
                                }
                                setActiveVaultForAction(null);
                                setVaultActionAmt('');
                              }}
                            >
                              <Text style={{ color: '#000', fontWeight: '800', fontSize: 11 }}>
                                Confirm {vaultActionType === 'DEPOSIT' ? 'Add' : 'Withdraw'}
                              </Text>
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                            <TouchableOpacity
                              style={styles.vaultDepositBtn}
                              onPress={() => {
                                setActiveVaultForAction(v.id);
                                setVaultActionType('DEPOSIT');
                              }}
                            >
                              <Text style={{ color: '#4ADE80', fontSize: 12, fontWeight: '700' }}>
                                + Add Funds
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.vaultWithdrawBtn}
                              onPress={() => {
                                setActiveVaultForAction(v.id);
                                setVaultActionType('WITHDRAW');
                              }}
                            >
                              <Text style={{ color: '#F87171', fontSize: 12, fontWeight: '700' }}>
                                − Withdraw
                              </Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </>
              )}
            </ScrollView>
          )}

          {/* =============================================================== */}
          {/* TAB 4: LEDGER (Full Transaction History from LedgerScreen.tsx)  */}
          {/* =============================================================== */}
          {activeTab === 'history' && (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}
            >
              <View style={styles.typeSwitcher}>
                {[
                  { id: 'ALL', label: `All (${transactions.length})` },
                  { id: 'EXPENSE', label: 'Outflow (Expenses)' },
                  { id: 'INCOME', label: 'Inflow (Salary)' }
                ].map((f) => (
                  <TouchableOpacity
                    key={f.id}
                    style={[styles.typeBtn, ledgerFilter === f.id && styles.typeBtnActive]}
                    onPress={() => setLedgerFilter(f.id)}
                  >
                    <Text
                      style={[
                        styles.typeBtnText,
                        ledgerFilter === f.id && styles.typeBtnTextActive
                      ]}
                    >
                      {f.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {filteredLedger.length === 0 ? (
                <View style={styles.sectionCard}>
                  <Text style={styles.emptyText}>
                    No transactions found for this filter.
                  </Text>
                </View>
              ) : (
                filteredLedger.map((tx) => {
                  const isInc = tx.type === 'INCOME';
                  return (
                    <View key={tx.id} style={styles.ledgerCard}>
                      <View style={styles.txIconBox}>
                        <Text style={{ fontSize: 16 }}>{tx.emoji || (isInc ? '💵' : '🍔')}</Text>
                      </View>
                      <View style={{ flex: 1, marginHorizontal: 10 }}>
                        <Text style={styles.txTitle}>{tx.description || tx.category}</Text>
                        <Text style={styles.txMeta}>
                          {tx.category} • {tx.paymentMethod} • {tx.dateText}
                        </Text>
                        {tx.breakdownText ? (
                          <Text style={styles.txBreakdown}>{tx.breakdownText}</Text>
                        ) : null}
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text
                          style={[
                            styles.txAmount,
                            isInc ? { color: '#4ADE80' } : { color: '#F87171' }
                          ]}
                        >
                          {isInc ? '+' : '−'}₱
                          {Number(tx.amount).toLocaleString('en-US', {
                            minimumFractionDigits: 2
                          })}
                        </Text>
                        <TouchableOpacity
                          onPress={() => onDeleteTransaction(tx)}
                          style={{ marginTop: 4 }}
                        >
                          <Text style={{ color: '#71717A', fontSize: 11 }}>↩️ Undo</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })
              )}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'flex-end'
  },
  container: {
    height: '92%',
    backgroundColor: '#000000',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: '#262626',
    paddingTop: 16
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1C1C1E'
  },
  appTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.4
  },
  appSub: {
    color: '#A1A1AA',
    fontSize: 11,
    marginTop: 2
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
    marginRight: 5
  },
  liveText: {
    color: '#E4E4E7',
    fontSize: 10,
    fontWeight: '700'
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#262626',
    alignItems: 'center',
    justifyContent: 'center'
  },
  closeBtnText: {
    color: '#A1A1AA',
    fontSize: 15,
    fontWeight: '700'
  },
  mainTabBar: {
    flexDirection: 'row',
    backgroundColor: '#0A0A0A',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#1C1C1E'
  },
  mainTabBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#262626',
    alignItems: 'center'
  },
  mainTabBtnActive: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF'
  },
  mainTabText: {
    color: '#A1A1AA',
    fontSize: 11,
    fontWeight: '700'
  },
  mainTabTextActive: {
    color: '#000000',
    fontWeight: '800'
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40
  },

  // Hero Card (From OverviewScreen.tsx)
  heroCard: {
    backgroundColor: '#141414',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#262626',
    marginBottom: 14
  },
  heroHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start'
  },
  heroLabel: {
    color: '#A1A1AA',
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.6
  },
  heroFilterNote: {
    color: '#71717A',
    fontSize: 11,
    marginTop: 2
  },
  walletBadge: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999
  },
  walletBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700'
  },
  heroAmount: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: -0.8,
    marginVertical: 10
  },
  walletDrawer: {
    backgroundColor: '#0A0A0A',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#262626',
    marginBottom: 12
  },
  walletDrawerTitle: {
    color: '#71717A',
    fontSize: 10,
    fontWeight: '800',
    marginBottom: 8
  },
  walletItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#1C1C1E'
  },
  walletItemName: {
    color: '#E4E4E7',
    fontSize: 12.5,
    fontWeight: '600'
  },
  walletBalBtn: {
    backgroundColor: '#18181B',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6
  },
  walletItemBal: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '700'
  },
  walletInlineInput: {
    backgroundColor: '#18181B',
    color: '#FFF',
    borderWidth: 1,
    borderColor: '#52525B',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    width: 90,
    fontSize: 12
  },
  walletSaveMiniBtn: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6
  },

  inflowComparisonBox: {
    backgroundColor: '#0A0A0A',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1C1C1E',
    marginBottom: 12
  },
  inflowCompareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  inflowCompareCol: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  inflowIndicatorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4ADE80'
  },
  outflowIndicatorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#F87171'
  },
  inflowCompareLabel: {
    color: '#A1A1AA',
    fontSize: 10.5
  },
  inflowCompareVal: {
    color: '#4ADE80',
    fontSize: 13.5,
    fontWeight: '800',
    marginTop: 2
  },
  outflowCompareVal: {
    color: '#F87171',
    fontSize: 13.5,
    fontWeight: '800',
    marginTop: 2
  },
  inflowDivider: {
    width: 1,
    height: 28,
    backgroundColor: '#262626',
    marginHorizontal: 10
  },
  inflowProgressSection: {
    marginTop: 10
  },
  inflowProgressTrack: {
    height: 6,
    backgroundColor: '#262626',
    borderRadius: 99,
    overflow: 'hidden'
  },
  inflowProgressBar: {
    height: '100%',
    borderRadius: 99
  },
  inflowProgressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 5
  },
  inflowProgressSub: {
    color: '#A1A1AA',
    fontSize: 10.5
  },
  futureSalaryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181B',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#27272A',
    marginBottom: 12
  },
  futureSalaryLabel: {
    color: '#71717A',
    fontSize: 9.5,
    fontWeight: '800'
  },
  futureSalaryAmount: {
    color: '#38BDF8',
    fontSize: 13,
    fontWeight: '800',
    marginTop: 2
  },
  receiveSalaryBtn: {
    backgroundColor: '#10B981',
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 8
  },
  receiveSalaryBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800'
  },
  quickAddHeroBtn: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center'
  },
  quickAddHeroText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '800'
  },

  // 2x2 Stats Grid
  statsGrid: {
    gap: 8,
    marginBottom: 14
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8
  },
  statCard: {
    flex: 1,
    backgroundColor: '#141414',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#262626'
  },
  statLabel: {
    color: '#A1A1AA',
    fontSize: 11
  },
  statValue: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    marginTop: 4
  },

  sectionCard: {
    backgroundColor: '#141414',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#262626',
    marginBottom: 12
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700'
  },
  sectionBadge: {
    color: '#71717A',
    fontSize: 11
  },
  sectionLink: {
    color: '#A1A1AA',
    fontSize: 11.5,
    fontWeight: '700'
  },
  emptyText: {
    color: '#71717A',
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: 12
  },
  drainRow: {
    marginBottom: 10
  },
  drainTopLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4
  },
  drainName: {
    color: '#E4E4E7',
    fontSize: 12.5,
    fontWeight: '600'
  },
  drainAmt: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '700'
  },
  drainTrack: {
    height: 6,
    backgroundColor: '#262626',
    borderRadius: 99,
    overflow: 'hidden'
  },
  drainBar: {
    height: '100%',
    borderRadius: 99
  },

  txItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#1C1C1E'
  },
  txIconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    alignItems: 'center',
    justifyContent: 'center'
  },
  txTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700'
  },
  txMeta: {
    color: '#71717A',
    fontSize: 11,
    marginTop: 2
  },
  txBreakdown: {
    color: '#A1A1AA',
    fontSize: 11,
    marginTop: 2
  },
  txAmount: {
    fontSize: 13.5,
    fontWeight: '800'
  },

  // Quick Log & Forms
  typeSwitcher: {
    flexDirection: 'row',
    backgroundColor: '#141414',
    borderRadius: 12,
    padding: 3,
    borderWidth: 1,
    borderColor: '#262626',
    marginBottom: 14
  },
  typeBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 9,
    alignItems: 'center'
  },
  typeBtnActive: {
    backgroundColor: '#FFFFFF'
  },
  typeBtnText: {
    color: '#A1A1AA',
    fontSize: 11,
    fontWeight: '700'
  },
  typeBtnTextActive: {
    color: '#000000',
    fontWeight: '800'
  },
  fieldLabel: {
    color: '#A1A1AA',
    fontSize: 11.5,
    fontWeight: '700',
    marginBottom: 6
  },
  paymentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 14
  },
  paymentChip: {
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#262626',
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    marginRight: 6
  },
  paymentChipActive: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF'
  },
  paymentChipText: {
    color: '#A1A1AA',
    fontSize: 11.5,
    fontWeight: '700'
  },
  paymentChipTextActive: {
    color: '#000000',
    fontWeight: '800'
  },
  formCard: {
    backgroundColor: '#141414',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#262626',
    marginBottom: 14
  },
  input: {
    backgroundColor: '#0A0A0A',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#FFFFFF',
    fontSize: 13,
    marginBottom: 10
  },
  mapSpotChip: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    marginRight: 6
  },
  mapSpotChipText: {
    color: '#E4E4E7',
    fontSize: 11.5,
    fontWeight: '600'
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12
  },
  presetPill: {
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8
  },
  presetPillText: {
    color: '#E4E4E7',
    fontSize: 11.5,
    fontWeight: '700'
  },
  previewBox: {
    backgroundColor: '#0A0A0A',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    alignItems: 'center'
  },
  previewTop: {
    color: '#A1A1AA',
    fontSize: 11.5
  },
  previewBottom: {
    color: '#4ADE80',
    fontSize: 14,
    fontWeight: '800',
    marginTop: 4
  },
  whiteSubmitBtn: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center'
  },
  whiteSubmitBtnText: {
    color: '#000000',
    fontSize: 13.5,
    fontWeight: '800'
  },
  hr: {
    height: 1,
    backgroundColor: '#262626',
    marginVertical: 14
  },
  saveFutureBtn: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center'
  },
  vaultDepositBtn: {
    flex: 1,
    backgroundColor: 'rgba(74, 222, 128, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(74, 222, 128, 0.35)',
    paddingVertical: 7,
    borderRadius: 8,
    alignItems: 'center'
  },
  vaultWithdrawBtn: {
    flex: 1,
    backgroundColor: 'rgba(248, 113, 113, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.35)',
    paddingVertical: 7,
    borderRadius: 8,
    alignItems: 'center'
  },
  ledgerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141414',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#262626',
    marginBottom: 8
  }
});
