// 대시보드 KPI 집계 지표. Agent/FileEvent/Alert에서 파생되는 뷰 모델.
export interface DashboardMetric {
  agentsTotal: number;
  agentsOnline: number;
  agentsOffline: number;
  eventsToday: number;
  openAlerts: number;
}
