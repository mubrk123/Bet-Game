import { useState } from "react";
import { useLocation } from "wouter";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { User, Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [_, setLocation] = useLocation();
  const setCurrentUser = useStore(state => state.setCurrentUser);
  const { toast } = useToast();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!username || !password) {
      toast({
        title: "Error",
        description: "Please enter username and password",
        variant: "destructive"
      });
      return;
    }

    setIsLoading(true);

    try {
      const { user } = await api.login(username, password);
      
      // Update Zustand store with logged in user
      setCurrentUser({
        id: user.id,
        username: user.username,
        role: user.role,
        balance: parseFloat(user.balance),
        exposure: parseFloat(user.exposure),
        currency: user.currency
      });

      toast({
        title: "Welcome back!",
        description: `Logged in as ${user.role.toLowerCase()}`,
        className: "bg-green-600 text-white border-none"
      });

      // Redirect based on role - Admins and Super Admins go to admin panel
      const isAdminRole = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
      setLocation(isAdminRole ? '/admin' : '/');
    } catch (error: any) {
      toast({
        title: "Login Failed",
        description: error.message || "Invalid credentials",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background relative overflow-hidden">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-900/20 via-background to-background"></div>
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent"></div>
      
      <div className="relative z-10 w-full max-w-md px-4">
        <div className="text-center mb-8">
          <h1 className="font-heading text-4xl font-bold tracking-tighter text-primary neon-glow mb-2">PROBET<span className="text-foreground">X</span></h1>
          <p className="text-muted-foreground">Premium Betting Exchange & Casino</p>
        </div>

        <Card className="border-primary/20 bg-card/50 backdrop-blur-xl">
          <CardHeader>
            <CardTitle>Welcome Back</CardTitle>
            <CardDescription>Login to your account</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium" data-testid="label-username">Username</label>
                <div className="relative">
                  <User className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input 
                    data-testid="input-username"
                    placeholder="Enter username" 
                    className="pl-9"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={isLoading}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" data-testid="label-password">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input 
                    data-testid="input-password"
                    type="password"
                    placeholder="Enter password" 
                    className="pl-9"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isLoading}
                  />
                </div>
              </div>

              <Button 
                data-testid="button-login"
                type="submit" 
                className="w-full font-bold" 
                disabled={isLoading}
              >
                {isLoading ? "Logging in..." : "Login"}
              </Button>

            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
