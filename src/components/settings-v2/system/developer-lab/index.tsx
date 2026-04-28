import { useEffect, useState } from "react";
import { Code2, FlaskConical } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DeveloperSettings } from "../developer";
import { ExperimentalSettings } from "../experimental";

type DeveloperLabTab = "developer" | "experimental";

interface DeveloperLabSettingsProps {
  initialTab?: DeveloperLabTab;
}

export function DeveloperLabSettings({
  initialTab = "developer",
}: DeveloperLabSettingsProps = {}) {
  const [activeTab, setActiveTab] = useState<DeveloperLabTab>(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  return (
    <div className="space-y-6 pb-8">
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as DeveloperLabTab)}
        className="space-y-5"
      >
        <section className="rounded-[26px] border border-slate-200/80 bg-white px-5 py-4 shadow-sm shadow-slate-950/5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Code2 className="h-5 w-5 text-sky-600" />
                <h1 className="text-[24px] font-semibold tracking-tight text-slate-900">
                  开发者与实验功能
                </h1>
              </div>
              <p className="text-sm leading-6 text-slate-500">
                调试、诊断和不稳定能力集中在同一处；默认关闭，用完关回。
              </p>
            </div>

            <TabsList className="grid h-auto w-full grid-cols-2 rounded-[20px] border border-slate-200 bg-slate-50 p-1 shadow-sm shadow-slate-950/5 xl:w-[320px]">
              <TabsTrigger
                value="developer"
                data-testid="developer-lab-tab-developer"
                className="gap-2 rounded-[14px] px-4 py-3"
              >
                <Code2 className="h-4 w-4" />
                开发者工具
              </TabsTrigger>
              <TabsTrigger
                value="experimental"
                data-testid="developer-lab-tab-experimental"
                className="gap-2 rounded-[14px] px-4 py-3"
              >
                <FlaskConical className="h-4 w-4" />
                实验功能
              </TabsTrigger>
            </TabsList>
          </div>
        </section>

        <TabsContent value="developer" className="mt-0">
          <DeveloperSettings embedded />
        </TabsContent>
        <TabsContent value="experimental" className="mt-0">
          <ExperimentalSettings embedded />
        </TabsContent>
      </Tabs>
    </div>
  );
}
