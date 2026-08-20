import type {
  AppLocale,
  CollectiveTemplate,
  CollectiveTemplateKey,
  CollectiveTemplateLabels,
  ActivityStatus,
  ActivityType,
  DecisionMethod,
  IdentityKind,
  MemoryType,
  MembershipState,
} from "@guild-os/domain";
import type { UiCollectiveContext } from "../src/management-types";

interface LocalizedTemplateCopy {
  name: string;
  description: string;
  labels: CollectiveTemplateLabels;
}

const japanese: Record<CollectiveTemplateKey, LocalizedTemplateCopy> = {
  personal: {
    name: "個人＋AI",
    description: "自分と権限管理されたAIアシスタントで、記憶と仕事を共有します。",
    labels: {
      members: "人とAI", member: "協力者", human: "オーナー", agent: "AIアシスタント",
      service: "連携サービス", guildActor: "協力共同体", memory: "個人の業務記憶", memoryItem: "ノート",
      remember: "知識を残す", activity: "目標と仕事", activityItem: "タスク", startActivity: "タスクを始める",
      decisions: "承認", decision: "承認", history: "活動履歴", join: "招待する",
      leave: "外す", participant: "協力者", coordinator: "オーナー",
    },
  },
  blank: {
    name: "Blank Guild",
    description: "中立的な基本要素から、共同体の形を自由に作ります。",
    labels: {
      members: "メンバー", member: "メンバー", human: "人間", agent: "エージェント",
      service: "サービス", guildActor: "共同体", memory: "記憶", memoryItem: "記憶",
      remember: "記憶を残す", activity: "活動", activityItem: "活動", startActivity: "活動を始める",
      decisions: "意思決定", decision: "意思決定", history: "履歴", join: "参加する",
      leave: "退出する", participant: "参加者", coordinator: "調整役",
    },
  },
  company: {
    name: "会社",
    description: "人、業務、マニュアル、承認に適した会社用プリセットです。",
    labels: {
      members: "チーム", member: "チームメンバー", human: "社員", agent: "AIアシスタント",
      service: "連携サービス", guildActor: "協力組織", memory: "社内知識", memoryItem: "業務記録",
      remember: "文書を残す", activity: "仕事", activityItem: "タスク", startActivity: "仕事を始める",
      decisions: "承認", decision: "承認", history: "監査ログ", join: "オンボーディング",
      leave: "オフボーディング", participant: "スタッフ", coordinator: "マネージャー",
    },
  },
  community: {
    name: "コミュニティ",
    description: "メンバー、議論、イベント、共有記憶を運営します。",
    labels: {
      members: "メンバー", member: "メンバー", human: "メンバー", agent: "コミュニティAgent",
      service: "コミュニティサービス", guildActor: "協力コミュニティ", memory: "共有記憶", memoryItem: "共同体の記録",
      remember: "歴史を残す", activity: "企画", activityItem: "企画", startActivity: "企画を始める",
      decisions: "合意形成", decision: "意思決定", history: "共同体の歴史", join: "コミュニティへ参加",
      leave: "コミュニティを退出", participant: "メンバー", coordinator: "モデレーター",
    },
  },
  research: {
    name: "研究共同体",
    description: "研究者と研究Agentが、証拠と探究を共有します。",
    labels: {
      members: "研究メンバー", member: "研究者", human: "研究者", agent: "研究Agent",
      service: "研究サービス", guildActor: "共同研究組織", memory: "研究記憶", memoryItem: "研究記録",
      remember: "発見を記録", activity: "研究活動", activityItem: "研究", startActivity: "研究を始める",
      decisions: "研究判断", decision: "研究判断", history: "研究履歴", join: "研究チームへ参加",
      leave: "研究チームを退出", participant: "研究者", coordinator: "研究責任者",
    },
  },
  creator: {
    name: "創作集団",
    description: "アイデア、制作、編集、公開、来歴をまとめます。",
    labels: {
      members: "コラボレーター", member: "コラボレーター", human: "クリエイター", agent: "創作Agent",
      service: "公開サービス", guildActor: "創作パートナー", memory: "創作記憶", memoryItem: "創作記録",
      remember: "アイデアを残す", activity: "制作", activityItem: "作品", startActivity: "制作を始める",
      decisions: "レビュー", decision: "レビュー", history: "制作履歴", join: "集団へ参加",
      leave: "集団を退出", participant: "クリエイター", coordinator: "制作責任者",
    },
  },
  "open-source": {
    name: "オープンソースプロジェクト",
    description: "コントリビューター、Issue、プロジェクト記憶、レビューをまとめます。",
    labels: {
      members: "コントリビューター", member: "コントリビューター", human: "コントリビューター", agent: "Coding Agent",
      service: "自動化", guildActor: "連携プロジェクト", memory: "プロジェクト記憶", memoryItem: "プロジェクト記録",
      remember: "文書化する", activity: "Issueと活動", activityItem: "Issue", startActivity: "Issueを作成",
      decisions: "プロジェクト判断", decision: "プロジェクト判断", history: "プロジェクト履歴", join: "プロジェクトへ参加",
      leave: "プロジェクトを退出", participant: "コントリビューター", coordinator: "メンテナー",
    },
  },
  "agent-collective": {
    name: "Agent Collective",
    description: "人間のCustodianを分離したまま、複数Agentを安全に協調させます。",
    labels: {
      members: "Actor", member: "Agent", human: "Custodian", agent: "Agent",
      service: "Service", guildActor: "Peer Collective", memory: "Collective Memory", memoryItem: "Context",
      remember: "Contextを追加", activity: "Runと活動", activityItem: "Mission", startActivity: "Missionを開始",
      decisions: "Policyと承認", decision: "Policy判断", history: "Run履歴", join: "接続する",
      leave: "切断する", participant: "Agent", coordinator: "Orchestrator",
    },
  },
};

const simplifiedChinese: Record<CollectiveTemplateKey, LocalizedTemplateCopy> = {
  personal: {
    name: "个人＋AI", description: "让个人与受权限管理的AI助手共享记忆和工作。",
    labels: { members: "人与AI", member: "协作者", human: "所有者", agent: "AI助手", service: "连接服务", guildActor: "合作共同体", memory: "个人工作记忆", memoryItem: "笔记", remember: "保存知识", activity: "目标与工作", activityItem: "任务", startActivity: "开始任务", decisions: "审批", decision: "审批", history: "活动历史", join: "邀请", leave: "移除", participant: "协作者", coordinator: "所有者" },
  },
  blank: {
    name: "空白 Guild", description: "从中立的基本元素开始，自由塑造共同体。",
    labels: { members: "成员", member: "成员", human: "人类", agent: "代理", service: "服务", guildActor: "共同体", memory: "记忆", memoryItem: "记忆", remember: "留下记忆", activity: "活动", activityItem: "活动", startActivity: "开始活动", decisions: "决策", decision: "决策", history: "历史", join: "加入", leave: "退出", participant: "参与者", coordinator: "协调者" },
  },
  company: {
    name: "公司", description: "适合人员、业务、手册和审批的公司预设。",
    labels: { members: "团队", member: "团队成员", human: "员工", agent: "AI 助手", service: "集成服务", guildActor: "合作组织", memory: "内部知识", memoryItem: "业务记录", remember: "记录文档", activity: "工作", activityItem: "任务", startActivity: "开始工作", decisions: "审批", decision: "审批", history: "审计日志", join: "入职", leave: "离职", participant: "员工", coordinator: "经理" },
  },
  community: {
    name: "社区", description: "协调成员、讨论、活动和共享记忆。",
    labels: { members: "成员", member: "成员", human: "成员", agent: "社区代理", service: "社区服务", guildActor: "合作社区", memory: "共享记忆", memoryItem: "社区记录", remember: "保存历史", activity: "倡议", activityItem: "倡议", startActivity: "发起倡议", decisions: "集体决策", decision: "决策", history: "社区历史", join: "加入社区", leave: "退出社区", participant: "成员", coordinator: "版主" },
  },
  research: {
    name: "研究共同体", description: "让研究者与研究代理围绕证据和探索协作。",
    labels: { members: "研究成员", member: "研究者", human: "研究者", agent: "研究代理", service: "研究服务", guildActor: "研究伙伴", memory: "研究记忆", memoryItem: "研究记录", remember: "记录发现", activity: "研究活动", activityItem: "研究", startActivity: "开始研究", decisions: "研究决策", decision: "研究决策", history: "研究历史", join: "加入研究团队", leave: "退出研究团队", participant: "研究者", coordinator: "研究负责人" },
  },
  creator: {
    name: "创作共同体", description: "协调创意、创作、编辑、发布与来源记录。",
    labels: { members: "协作者", member: "协作者", human: "创作者", agent: "创作代理", service: "发布服务", guildActor: "创作伙伴", memory: "创作记忆", memoryItem: "创作记录", remember: "保存创意", activity: "创作", activityItem: "作品", startActivity: "开始创作", decisions: "评审", decision: "评审", history: "创作历史", join: "加入共同体", leave: "退出共同体", participant: "创作者", coordinator: "创作负责人" },
  },
  "open-source": {
    name: "开源项目", description: "协调贡献者、Issue、项目记忆和维护者评审。",
    labels: { members: "贡献者", member: "贡献者", human: "贡献者", agent: "编程代理", service: "自动化", guildActor: "合作项目", memory: "项目记忆", memoryItem: "项目记录", remember: "编写文档", activity: "Issue 与活动", activityItem: "Issue", startActivity: "创建 Issue", decisions: "项目决策", decision: "项目决策", history: "项目历史", join: "加入项目", leave: "退出项目", participant: "贡献者", coordinator: "维护者" },
  },
  "agent-collective": {
    name: "代理共同体", description: "在保留独立人类监护人的同时安全协调多个代理。",
    labels: { members: "参与主体", member: "代理", human: "监护人", agent: "代理", service: "服务", guildActor: "同级共同体", memory: "共同记忆", memoryItem: "上下文", remember: "添加上下文", activity: "运行与活动", activityItem: "任务", startActivity: "开始任务", decisions: "策略与审批", decision: "策略决策", history: "运行历史", join: "连接", leave: "断开", participant: "代理", coordinator: "编排者" },
  },
};

export function localizeTemplate(
  template: CollectiveTemplate,
  locale: AppLocale,
): CollectiveTemplate {
  if (locale === "en") return template;
  const copy = locale === "ja" ? japanese[template.key] : simplifiedChinese[template.key];
  return { ...template, ...copy };
}

export function localizeCollectiveContext(
  context: UiCollectiveContext,
  locale: AppLocale,
  customTemplateCopy?: Readonly<Pick<CollectiveTemplate, "name" | "description">>,
): UiCollectiveContext {
  const templates = context.templates.map((template) => localizeTemplate(template, locale));
  const localizedTemplate = templates.find((candidate) => candidate.key === context.template.key) ??
    context.template;
  const template = context.blueprint
    ? context.template
    : context.template.key === "blank" &&
      Object.keys(context.vocabularyOverrides).length > 0 && customTemplateCopy
    ? { ...localizedTemplate, ...customTemplateCopy }
    : localizedTemplate;
  const labels = { ...template.labels, ...context.vocabularyOverrides };
  return {
    ...context,
    template,
    templates,
    labels,
    spaces: context.spaces.map((space) => {
      const blueprint = space.blueprintKey
        ? context.blueprints.find((candidate) => candidate.key === space.blueprintKey)
        : null;
      const profile = space.vocabularyProfileKey
        ? templates.find((candidate) => candidate.key === space.vocabularyProfileKey)
        : null;
      return { ...space, labels: blueprint?.definition.labels ?? profile?.labels ?? labels };
    }),
  };
}

const memoryTypeLabels: Record<AppLocale, Record<string, string>> = {
  en: { fact: "Fact", document: "Document", conversation: "Conversation", event: "Event", experience: "Experience", rule: "Rule", decision: "Decision", artifact: "Artifact", research: "Research", data: "Data", manual: "Manual", failure: "Failure", learning: "Learning", external: "External source", external_source: "External source", agent_output: "Agent output", knowledge: "Canonical knowledge" },
  ja: { fact: "事実", document: "文書", conversation: "会話", event: "出来事", experience: "経験", rule: "ルール", decision: "意思決定", artifact: "成果物", research: "調査結果", data: "データ", manual: "マニュアル", failure: "失敗", learning: "学び", external: "外部資料", external_source: "外部情報源", agent_output: "Agent成果物", knowledge: "正式な知識" },
  "zh-CN": { fact: "事实", document: "文档", conversation: "对话", event: "事件", experience: "经验", rule: "规则", decision: "决策", artifact: "成果物", research: "研究", data: "数据", manual: "手册", failure: "失败", learning: "学习", external: "外部资料", external_source: "外部来源", agent_output: "代理成果", knowledge: "正式知识" },
};

const activityTypeLabels: Record<AppLocale, Record<string, string>> = {
  en: { task: "Task", project: "Project", quest: "Quest", event: "Event", discussion: "Discussion", experiment: "Experiment", study: "Study", campaign: "Campaign", ritual: "Ritual", session: "Session", creation: "Creation", maintenance: "Maintenance", investigation: "Investigation", mission: "Mission", goal: "Goal", step: "Step" },
  ja: { task: "タスク", project: "プロジェクト", quest: "クエスト", event: "イベント", discussion: "議論", experiment: "実験", study: "研究", campaign: "キャンペーン", ritual: "儀式", session: "セッション", creation: "制作", maintenance: "保守", investigation: "調査", mission: "ミッション", goal: "目標", step: "手順" },
  "zh-CN": { task: "任务", project: "项目", quest: "Quest", event: "活动", discussion: "讨论", experiment: "实验", study: "研究", campaign: "行动", ritual: "仪式", session: "会期", creation: "创作", maintenance: "维护", investigation: "调查", mission: "任务行动", goal: "目标", step: "步骤" },
};

const activityStatusLabels: Record<AppLocale, Record<ActivityStatus, string>> = {
  en: { proposed: "Proposed", planned: "Planned", ready: "Ready", active: "Active", paused: "Paused", blocked: "Blocked", completed: "Completed", cancelled: "Cancelled", archived: "Archived" },
  ja: { proposed: "提案中", planned: "計画済み", ready: "開始可能", active: "進行中", paused: "一時停止", blocked: "停止要因あり", completed: "完了", cancelled: "中止", archived: "アーカイブ済み" },
  "zh-CN": { proposed: "提议中", planned: "已计划", ready: "可开始", active: "进行中", paused: "已暂停", blocked: "受阻", completed: "已完成", cancelled: "已取消", archived: "已归档" },
};

const decisionMethodLabels: Record<AppLocale, Record<DecisionMethod, string>> = {
  en: {
    custodian: "Custodian decision",
    consent: "Consent",
    vote: "Vote",
    review: "Review",
    editorial: "Editorial review",
    policy: "Policy evaluation",
    hybrid: "Policy + Human approval",
    quorum_vote: "Quorum vote",
    council: "Council review",
    agent_proposal_human_approval: "Agent proposal + Human approval",
    custom: "Custom governed method",
  },
  ja: {
    custodian: "管理責任者による判断",
    consent: "合意",
    vote: "投票",
    review: "査読・レビュー",
    editorial: "編集レビュー",
    policy: "ポリシー判定",
    hybrid: "ポリシー判定＋人間承認",
    quorum_vote: "定足数投票",
    council: "評議会レビュー",
    agent_proposal_human_approval: "Agent提案＋人間承認",
    custom: "独自の統治方式",
  },
  "zh-CN": {
    custodian: "监护人决策",
    consent: "共识",
    vote: "投票",
    review: "评审",
    editorial: "编辑评审",
    policy: "策略判定",
    hybrid: "策略判定＋人工批准",
    quorum_vote: "法定人数投票",
    council: "理事会评审",
    agent_proposal_human_approval: "Agent提案＋人工批准",
    custom: "自定义治理方式",
  },
};

export function memoryTypeLabel(type: MemoryType, locale: AppLocale, customLabel?: string): string {
  return customLabel?.trim() || (memoryTypeLabels[locale][type] ?? type.replace(/^custom:/, "").replaceAll("_", " "));
}

export function activityTypeLabel(type: ActivityType, locale: AppLocale, customLabel?: string): string {
  return customLabel?.trim() || (activityTypeLabels[locale][type] ?? type.replace(/^custom:/, "").replaceAll("_", " "));
}

export function activityStatusLabel(status: ActivityStatus, locale: AppLocale): string {
  return activityStatusLabels[locale][status];
}

export function decisionMethodLabel(method: DecisionMethod, locale: AppLocale, customLabel?: string): string {
  return customLabel?.trim() || decisionMethodLabels[locale][method];
}

const neutralMembershipLabels: Record<AppLocale, Record<MembershipState, string>> = {
  en: { invited: "Invited", preboarding: "Joined", active: "Active", suspended: "Paused", departed: "Left" },
  ja: { invited: "招待中", preboarding: "参加準備中", active: "参加中", suspended: "一時停止", departed: "退出済み" },
  "zh-CN": { invited: "已邀请", preboarding: "已加入", active: "活跃", suspended: "已暂停", departed: "已退出" },
};

const companyMembershipLabels: Record<AppLocale, Record<MembershipState, string>> = {
  en: { invited: "Invited", preboarding: "Preboarding", active: "Active", suspended: "Suspended", departed: "Offboarded" },
  ja: { invited: "招待中", preboarding: "入社準備中", active: "在籍中", suspended: "停止中", departed: "退職済み" },
  "zh-CN": { invited: "已邀请", preboarding: "入职准备中", active: "在职", suspended: "已停用", departed: "已离职" },
};

export function membershipStateLabel(
  state: MembershipState | null,
  templateKey: CollectiveTemplateKey,
  locale: AppLocale,
): string {
  if (state === null) return neutralMembershipLabels[locale].invited;
  return (templateKey === "company" ? companyMembershipLabels : neutralMembershipLabels)[locale][state];
}

export function actorKindLabel(
  kind: IdentityKind,
  labels: CollectiveTemplateLabels,
): string {
  switch (kind) {
    case "human": return labels.human;
    case "agent": return labels.agent;
    case "service": return labels.service;
    case "guild": return labels.guildActor;
  }
}
