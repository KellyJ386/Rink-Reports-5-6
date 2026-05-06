import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

interface StubPageProps {
  title: string
  description?: string
}

export function StubPage({ title, description }: StubPageProps) {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Coming soon</CardTitle>
          <CardDescription>
            This section will be built in a later phase.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Configuration, tooling, and reports for {title.toLowerCase()} will
          live here.
        </CardContent>
      </Card>
    </div>
  )
}
