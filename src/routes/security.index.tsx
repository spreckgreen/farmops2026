import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { AppLayout } from "@/components/app-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { CamerasWindow } from "@/components/security/cameras-window";

export const Route = createFileRoute("/security/")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({
    meta: [
      { title: "Security — cameras, coverage and status | Bostead Farms" },
      {
        name: "description",
        content:
          "The farm security tab: watch cameras live, see what each one covers on the building plan, and check which cameras are answering.",
      },
      { property: "og:title", content: "Security — cameras, coverage and status" },
      {
        property: "og:description",
        content:
          "Live camera feeds, recorded coverage on the building plan, and on-demand reachability checks for Bostead Farms.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SecurityPage,
});

function SecurityPage() {
  return (
    <AppLayout>
      <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
        <header className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <ShieldCheck className="h-6 w-6 text-primary" aria-hidden /> Security
          </h1>
          <p className="text-sm text-muted-foreground">
            Everything that watches the place. Cameras live here as one window; other security
            windows can join this tab as they are built.
          </p>
        </header>

        <Tabs defaultValue="cameras">
          <TabsList>
            <TabsTrigger value="cameras">Cameras</TabsTrigger>
            <TabsTrigger value="connections">Camera brands</TabsTrigger>
          </TabsList>

          <TabsContent value="cameras" className="mt-4">
            <CamerasWindow />
          </TabsContent>

          <TabsContent value="connections" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Ring</CardTitle>
                <CardDescription>
                  What is actually possible today, with no guesswork.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>
                  Ring does not offer a public sign-in-and-connect service for other apps to pull
                  its live video. Its own app, plus Alexa, are the supported ways to watch a Ring
                  camera, so there is nothing official we can plug straight into this tab.
                </p>
                <p>
                  Unofficial workarounds exist, but they log in as you with your Ring password and
                  break every time Ring changes something — they also put your account at risk, so
                  they are not a good foundation for the farm record.
                </p>
                <p className="font-medium text-foreground">Two dependable paths:</p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>
                    Run a small bridge on the farm network (for example Home Assistant or Scrypted)
                    that re-publishes a camera as a plain web video address, then paste that address
                    into the camera here.
                  </li>
                  <li>
                    For new purchases, choose cameras that publish a standard stream themselves.
                    Those work in this tab immediately with no bridge.
                  </li>
                </ul>
                <p>
                  Meanwhile the eight planned Ring positions stay fully useful here: they are
                  recorded, mapped, powered from the recorded panel and shown on the coverage plan
                  even without a live picture.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Cameras that work here now</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Any camera that gives you a web address for its picture: a live stream link, a plain
                video file link, a repeating snapshot image, or a page the maker lets you embed. Add
                it on the Cameras window and it plays in place.
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
