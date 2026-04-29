/**
 * @file 连接测试类型
 * @description Provider 设置页连接测试的共享返回类型。
 * @module components/api-key-provider/connectionTestTypes
 */

export interface ConnectionTestResult {
  success: boolean;
  latencyMs?: number;
  error?: string;
  models?: string[];
}
